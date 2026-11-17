// backend/src/jobs/fulfillmentOrchestrator.js
// Orquestador de fulfillment post-pago — F1 Logística
// Se dispara desde storeWebhook cuando pedido pasa a PAGADO

const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const { enviameClient } = require('../services/enviameClient');
const fcmService = require('../services/fcmNotificationService');

/**
 * Procesa fulfillment de un pedido recién pagado
 * @param {string} orderId - UUID del pedido
 * @param {Object} client - Cliente PG (opcional, para transacción externa)
 * @returns {Promise<Object>} Resultado del fulfillment
 */
async function _processOrderFulfillmentTx(orderId, db) {
  try {

    // 1. Obtener pedido con items y dirección
    const orderRes = await db.query(
      `SELECT pt.*, 
              json_agg(json_build_object(
                'producto_id', dpt.producto_id,
                'cantidad', dpt.cantidad,
                'nombre', p.nombre,
                'peso_estimado_kg', COALESCE(p.peso_kg, 0.5)
              )) FILTER (WHERE dpt.id IS NOT NULL) AS items
       FROM pedidos_tienda pt
       LEFT JOIN detalles_pedido_tienda dpt ON dpt.pedido_id = pt.id
       LEFT JOIN productos p ON p.id = dpt.producto_id
       WHERE pt.id = $1
       GROUP BY pt.id`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      throw new Error(`Pedido ${orderId} no encontrado`);
    }

    const order = orderRes.rows[0];
    
    // 2. Verificar estado: solo procesar si PAGADO
    if (order.estado !== 'PAGADO') {
      console.log(`[FULFILLMENT] Pedido ${orderId} estado=${order.estado}, omitiendo`);
      return { skipped: true, reason: `Estado ${order.estado} no es PAGADO` };
    }

    // 3. ¿Es entrega en cita? (booking_id presente y tiene prestador_comisionado_id)
    const esEntregaEnCita = !!order.booking_id && !!order.prestador_comisionado_id;
    
    if (esEntregaEnCita) {
      // Entrega en cita: no hay envío courier, el proveedor lleva los productos
      await db.query(
        `UPDATE pedidos_tienda SET estado = 'DESPACHADO', despachado_en = NOW() WHERE id = $1`,
        [orderId]
      );
      
      // Notificar al proveedor que tiene productos para entregar en la cita
      if (order.prestador_comisionado_id) {
        await _notifyProviderForCitaDelivery(db, order);
      }

      return { success: true, tipo: 'entrega_en_cita', orderId };
    }

    // 4. ENVÍO ESTÁNDAR: Determinar proveedor/es que despachan
    // Agrupar items por proveedor (productos tienen proveedor dueño)
    const itemsByProvider = await _groupItemsByProvider(db, order.items || []);
    
    const enviosCreados = [];
    
    for (const [providerId, providerItems] of Object.entries(itemsByProvider)) {
      // 4.1 Crear registro en tabla envios (estado CREADO)
      const envioData = await _createEnvioRecord(db, order, providerId, providerItems);
      enviosCreados.push(envioData);

      // 4.2 Notificar al proveedor que tiene pedido para preparar
      await _notifyProviderNewOrder(db, order, providerId, envioData);
    }

    // 5. Actualizar pedido a estado procesado (queda en PAGADO hasta que proveedor despache)
    // El estado DESPACHADO se pone cuando proveedor hace dispatch desde su app

    return { 
      success: true, 
      tipo: 'envio_estandar',
      orderId,
      envios: enviosCreados,
      proveedoresNotificados: Object.keys(itemsByProvider).length
    };

  } catch (err) {
    console.error(`[FULFILLMENT ERROR] Pedido ${orderId}:`, err);
    throw err;
  }
}

/**
 * Punto de entrada público.
 *
 * RLS: el pool de la aplicación (app_rls_user) no lleva tenant ni rol en el
 * contexto, así que pedidos_tienda, productos y carrier_accounts devuelven 0
 * filas (medido en staging: 0 productos/0 carrier sin escalar, 37/5 con
 * app_system). Los caminos que no nacen de una petición autenticada escalan.
 *
 * @param {string} orderId
 * @param {Object|null} client conexión de una transacción ya abierta por el
 *        llamador; si se pasa, no se abre ni se cierra transacción aquí.
 */
async function processOrderFulfillment(orderId, client = null) {
  if (client) return _processOrderFulfillmentTx(orderId, client);
  return runAsSystem({ pool, systemPool }, (c) => _processOrderFulfillmentTx(orderId, c));
}

/**
 * Agrupa items del pedido por proveedor dueño del producto
 */
async function _groupItemsByProvider(db, items) {
  if (!items || items.length === 0) return {};

  const productIds = items.map(i => i.producto_id).filter(Boolean);
  if (productIds.length === 0) return {};

  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await db.query(
    `SELECT id, proveedor_id FROM productos WHERE id IN (${placeholders})`,
    productIds
  );

  const productToProvider = {};
  for (const row of res.rows) {
    productToProvider[row.id] = row.proveedor_id;
  }

  const grouped = {};
  for (const item of items) {
    const providerId = productToProvider[item.producto_id] || 'sin_proveedor';
    if (!grouped[providerId]) grouped[providerId] = [];
    grouped[providerId].push(item);
  }

  return grouped;
}

/**
 * Crea registro en tabla envios con datos de origen/destino
 */
async function _createEnvioRecord(db, order, providerId, providerItems) {
  // Obtener dirección de origen (proveedor o salón)
  let origen = await _getOrigenDireccion(db, providerId);
  
  // Si no hay dirección de proveedor, usar fallback (bodega central o admin)
  if (!origen) {
    origen = await _getFallbackOrigen(db);
  }

  // Calcular peso total
  const pesoTotalKg = providerItems.reduce(
    (sum, item) => sum + (item.peso_estimado_kg || 0.5) * (item.cantidad || 1), 
    0
  );

  // Determinar transportadora sugerida por zona (usar shippingService)
  const { cotizarEnvio } = require('../services/shippingService');
  const cotizacion = await cotizarEnvio({
    ciudad: order.ciudad,
    departamento: order.departamento,
    codigo_postal: order.codigo_postal,
    peso_total_kg: Math.max(0.5, pesoTotalKg),
    valor_pedido: order.total
  });

  const transportadoraSugerida = cotizacion.transportadora;

  // Insertar en envios
  const res = await db.query(
    `INSERT INTO envios (
      pedido_id, transportadora, estado, observaciones,
      origen_tipo_via, origen_numero_principal, origen_letra_principal,
      origen_numero_secundario, origen_letra_secundaria, origen_complemento,
      origen_barrio, origen_ciudad, origen_departamento, origen_codigo_postal,
      origen_dane_code, destino_ciudad, destino_departamento, destino_codigo_postal, prestador_id
    ) VALUES ($1,$2,'CREADO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      order.id,
      transportadoraSugerida,
      `Auto-creado post-pago para proveedor ${providerId}`,
      origen.tipo_via,
      origen.numero_principal,
      origen.letra_principal,
      origen.numero_secundario,
      origen.letra_secundaria,
      origen.complemento,
      origen.barrio,
      origen.ciudad,
      origen.departamento,
      origen.codigo_postal,
      origen.dane_code,
      order.ciudad || null,
      order.departamento || null,
      order.codigo_postal || null,
      providerId === 'sin_proveedor' ? null : providerId
    ]
  );

  return res.rows[0];
}

/**
 * Obtiene dirección estructurada del proveedor
 */
async function _getOrigenDireccion(db, providerId) {
  if (!providerId || providerId === 'sin_proveedor') return null;

  const res = await db.query(
    `SELECT 
      bp.direccion_tipo_via AS tipo_via,
      bp.direccion_numero_principal AS numero_principal,
      bp.direccion_letra_principal AS letra_principal,
      bp.direccion_numero_secundario AS numero_secundario,
      bp.direccion_letra_secundaria AS letra_secundaria,
      bp.direccion_complemento AS complemento,
      bp.direccion_barrio AS barrio,
      bp.direccion_ciudad AS ciudad,
      bp.direccion_departamento AS departamento,
      bp.direccion_codigo_postal AS codigo_postal,
      bp.direccion_dane_code AS dane_code
    FROM business_profiles bp
    WHERE bp.provider_id = $1 AND bp.activo = true
    LIMIT 1`,
    [providerId]
  );

  if (res.rows.length === 0) return null;

  const d = res.rows[0];
  // Validar campos mínimos
  if (!d.tipo_via || !d.numero_principal || !d.ciudad || !d.departamento) return null;

  return {
    tipo_via: d.tipo_via,
    numero_principal: d.numero_principal,
    letra_principal: d.letra_principal,
    numero_secundario: d.numero_secundario,
    letra_secundaria: d.letra_secundaria,
    complemento: d.complemento,
    barrio: d.barrio,
    ciudad: d.ciudad,
    departamento: d.departamento,
    codigo_postal: d.codigo_postal,
    dane_code: d.dane_code || _inferDaneCode(d.ciudad, d.departamento)
  };
}

/**
 * Dirección fallback (bodega central / admin)
 */
async function _getFallbackOrigen(db) {
  // TODO: Configurar en platform_config o variable de entorno
  return {
    tipo_via: 'Calle',
    numero_principal: '100',
    letra_principal: null,
    numero_secundario: '20',
    letra_secundaria: null,
    complemento: 'Bodega Central GlowApp',
    barrio: 'Centro Administrativo',
    ciudad: 'Bogotá',
    departamento: 'Cundinamarca',
    codigo_postal: '110111',
    dane_code: '11001'
  };
}

/**
 * Infiere código DANE básico para ciudades principales
 */
function _inferDaneCode(ciudad, departamento) {
  const map = {
    'bogota': '11001', 'medellin': '05001', 'cali': '76001',
    'barranquilla': '08001', 'cartagena': '13001', 'bucaramanga': '68001',
    'pereira': '66001', 'manizales': '17001', 'ibague': '73001',
    'villavicencio': '50001'
  };
  const key = (ciudad || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return map[key] || '11001';
}

/**
 * Notifica al proveedor que tiene pedido para entregar en cita
 */
async function _notifyProviderForCitaDelivery(db, order) {
  try {
    await fcmService.sendToUser(order.prestador_comisionado_id, {
      title: '📦 Productos para cita agendada',
      body: `Pedido #${order.id.slice(0,8)}: tienes productos para llevar a la cita. Revisa en "Pedidos por entregar".`,
      data: { type: 'CITA_DELIVERY', orderId: order.id, screen: '/provider/fulfillment' }
    });
  } catch (e) {
    console.warn('[FULFILLMENT] FCM cita delivery falló:', e.message);
  }
}

/**
 * Notifica al proveedor nuevo pedido para preparar/despachar
 */
async function _notifyProviderNewOrder(db, order, providerId, envio) {
  try {
    await fcmService.sendToUser(providerId, {
      title: '📋 Nuevo pedido para despachar',
      body: `Pedido #${order.id.slice(0,8)} listo para preparar. Transportadora sugerida: ${envio.transportadora}`,
      data: { type: 'NEW_FULFILLMENT', orderId: order.id, envioId: envio.id, screen: '/provider/fulfillment' }
    });
  } catch (e) {
    console.warn('[FULFILLMENT] FCM new order falló:', e.message);
  }
}

/**
 * Job programado: revisar pedidos PAGADO sin fulfillment procesado
 * (para recuperar si webhook falló)
 */
async function recoverUnfulfilledOrders() {
  const res = await runAsSystem({ pool, systemPool }, (db) => db.query(
    `SELECT id FROM pedidos_tienda 
     WHERE estado = 'PAGADO' 
     AND booking_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = pedidos_tienda.id)
     AND pagado_en < NOW() - INTERVAL '10 minutes'
     LIMIT 50`
  ));

  for (const row of res.rows) {
    try {
      await processOrderFulfillment(row.id);
      console.log(`[FULFILLMENT RECOVER] Procesado pedido ${row.id}`);
    } catch (e) {
      console.error(`[FULFILLMENT RECOVER] Error en ${row.id}:`, e.message);
    }
  }

  return { procesados: res.rows.length };
}

module.exports = {
  processOrderFulfillment,
  recoverUnfulfilledOrders
};