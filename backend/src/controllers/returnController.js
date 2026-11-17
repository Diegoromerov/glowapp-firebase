// backend/src/controllers/returnController.js
// Devoluciones (reverse logistics): cliente solicita, proveedor aprueba/rechaza/recibe, reembolso

const { pool, systemPool } = require('../config/db');
const { runInTenantTransaction, runAsSystem } = require('../config/tenantRouting');
const { notificarPartesEnvio } = require('../services/notificationService');
const { EnviameClient } = require('../services/enviameClient');

/**
 * POST /api/client/orders/:id/return
 * Cliente solicita devolución
 * Body: { motivo, fotos[], items: [{producto_id, cantidad}] }
 */
async function solicitarDevolucion(req, res) {
  const clienteId = req.user.id;
  const tenantId = req.user.tenant_id;
  const orderId = req.params.id;
  const { motivo, descripcion, fotos = [], items, envio_id } = req.body;
  const motivosValidos = ['defectuoso', 'no_gusta', 'talla_incorrecta', 'producto_incorrecto', 'dañado_envio', 'llegó_tarde', 'cambio_opinion', 'otro'];

  if (!motivosValidos.includes(motivo)) {
    return res.status(400).json({ error: 'Selecciona un motivo de devolución válido' });
  }
  if (typeof descripcion !== 'string' || descripcion.trim().length < 10) {
    return res.status(400).json({ error: 'La descripción debe tener al menos 10 caracteres' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items a devolver requeridos' });
  }
  if (new Set(items.map((item) => String(item?.producto_id))).size !== items.length ||
      items.some((item) => !Number.isInteger(Number(item?.cantidad)) || Number(item.cantidad) <= 0)) {
    return res.status(400).json({ error: 'Los productos no se deben repetir y las cantidades deben ser enteros positivos' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Verificar pedido: del cliente, estado ENTREGADO, dentro de ventana (ej 30 días)
      const pedidoRes = await client.query(
        `SELECT pt.*, e.id AS envio_original_id, e.prestador_id AS envio_prestador_id,
                e.estado AS envio_estado
           FROM pedidos_tienda pt
           JOIN envios e ON e.pedido_id = pt.id AND ($3::uuid IS NULL OR e.id = $3)
         WHERE pt.id = $1 AND pt.comprador_id = $2
            AND e.estado = 'ENTREGADO' AND pt.entregado_en > NOW() - INTERVAL '30 days'`,
        [orderId, clienteId, envio_id || null]
      );

      if (pedidoRes.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado, no entregado o fuera de plazo (30 días)' });
      }

      const pedido = pedidoRes.rows[0];

  const receptorId = pedido.envio_prestador_id;
      if (!receptorId) return res.status(409).json({ error: 'El pedido no tiene proveedor asignado para tramitar la devolución' });
      if (pedido.envio_estado !== 'ENTREGADO') {
        return res.status(409).json({ error: 'Solo se pueden devolver artículos de un envío entregado' });
      }

      // Validar que los artículos pertenezcan al proveedor del envío.
      for (const item of items) {
        const { producto_id, cantidad } = item;
        const itemRes = await client.query(
          `SELECT dpt.cantidad FROM detalles_pedido_tienda dpt JOIN productos p ON p.id = dpt.producto_id WHERE dpt.pedido_id = $1 AND dpt.producto_id = $2 AND p.proveedor_id = $3`,
          [orderId, producto_id, receptorId]
        );
        if (itemRes.rows.length === 0) {
          return res.status(400).json({ error: `Producto ${producto_id} no está en este pedido` });
        }
        if (Number(cantidad) > Number(itemRes.rows[0].cantidad)) {
          return res.status(400).json({ error: `Cantidad a devolver excede la comprada para producto ${producto_id}` });
        }
      }

      // Crear devolución
      const devRes = await client.query(
        `INSERT INTO devoluciones (
           pedido_id, envio_original_id, solicitante_id, receptor_id, tenant_id,
           estado, motivo, descripcion, items, fotos_urls
         ) VALUES ($1,$2,$3,$4,$5,'SOLICITADA',$6,$7,$8::jsonb,$9)
         RETURNING *`,
        [orderId, pedido.envio_original_id, clienteId, receptorId, tenantId, motivo, descripcion.trim(), JSON.stringify(items), fotos]
      );

      const devolucion = devRes.rows[0];

      // Notificar a proveedor
      await notificarPartesEnvio({
        guia: `DEV-${devolucion.id}`, // guía temporal
        eventoTipo: 'DEVOLUCION_SOLICITADA',
        contextoExtra: {
          devolucion_id: devolucion.id,
          pedido_id: orderId,
          motivo,
          items,
        },
      });

      res.json({ success: true, data: devolucion });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/client/orders/:id/return:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al solicitar devolución' });
  }
}

/**
 * GET /api/client/returns
 * Cliente lista sus devoluciones
 */
async function getMisDevoluciones(req, res) {
  const clienteId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
        const { rows } = await client.query(
        `SELECT d.*, pt.total as pedido_total, pt.creado_en as pedido_creado
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         WHERE d.solicitante_id = $1
         ORDER BY d.solicitada_en DESC`,
        [clienteId]
      );

      res.json({ success: true, data: rows });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/client/returns:', error);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
}

/**
 * GET /api/provider/returns
 * Proveedor lista devoluciones de sus pedidos
 */
async function getProviderDevoluciones(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  if (!['provider', 'salon'].includes(req.user.role)) return res.status(403).json({ error: 'Solo proveedores y salones pueden consultar devoluciones' });

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.*, pt.total as pedido_total, pt.nombre_entrega, pt.ciudad, pt.departamento,
                u.nombre as cliente_nombre, u.email as cliente_email, u.telefono as cliente_telefono
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         LEFT JOIN usuarios u ON u.id = d.solicitante_id
         WHERE d.receptor_id = $1
         ORDER BY d.solicitada_en DESC`,
        [providerId]
      );

      res.json({ success: true, data: rows });
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/provider/returns:', error);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
}

/**
 * POST /api/provider/returns/:id/approve
 * Proveedor aprueba devolución y genera etiqueta de retorno via Envíame
 * Body: { carrier_retorno?, service_code_retorno? }
 */
async function aprobarDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  if (!['provider', 'salon'].includes(req.user.role)) return res.status(403).json({ error: 'Solo proveedores y salones pueden tramitar devoluciones' });
  const devolucionId = req.params.id;
  const { carrier_retorno, service_code_retorno } = req.body;

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      // Verificar devolución pertenece a este proveedor y está SOLICITADA
      const devRes = await client.query(
        `SELECT d.*, pt.id as pedido_id, pt.comprador_id, pt.prestador_comisionado_id,
                pt.ciudad, pt.departamento, pt.codigo_postal, pt.direccion_entrega, pt.total as pedido_total,
                e.destino_ciudad, e.destino_departamento, e.destino_codigo_postal,
                u.nombre as cliente_nombre, u.telefono as cliente_telefono
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         LEFT JOIN envios e ON e.id = d.envio_original_id
         LEFT JOIN usuarios u ON u.id = d.solicitante_id
         WHERE d.id = $1 AND d.receptor_id = $2 AND d.estado = 'SOLICITADA'`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada, no autorizada o ya procesada' });
      }

      const devolucion = devRes.rows[0];

      // Obtener dirección origen (proveedor) para retorno
      const origenRes = await client.query(
        `SELECT direccion_tipo_via AS tipo_via,
                direccion_numero_principal AS numero_principal,
                direccion_letra_principal AS letra_principal,
                direccion_numero_secundario AS numero_secundario,
                direccion_letra_secundaria AS letra_secundaria,
                direccion_complemento AS complemento,
                direccion_barrio AS barrio,
                direccion_ciudad AS ciudad,
                direccion_departamento AS departamento,
                direccion_codigo_postal AS codigo_postal,
                direccion_dane_code AS dane_code
           FROM business_profiles
          WHERE provider_id = $1 AND activo = true
          ORDER BY created_at DESC LIMIT 1`,
        [providerId]
      );
      if (origenRes.rows.length === 0) {
        return res.status(400).json({ error: 'Proveedor no tiene dirección configurada (business_profile)' });
      }
      const origen = origenRes.rows[0];

      // Dirección destino = dirección del proveedor (retorno)
      const destino = {
        ciudad: origen.ciudad,
        departamento: origen.departamento,
        codigo_postal: origen.codigo_postal,
        street: `${origen.tipo_via || ''} ${origen.numero_principal || ''}${origen.letra_principal || ''} ${origen.numero_secundario || ''}${origen.letra_secundaria || ''} ${origen.complemento || ''} ${origen.barrio || ''}`.trim(),
      };

      // Origen = dirección del cliente
      const origenCliente = {
        ciudad: devolucion.destino_ciudad || devolucion.ciudad,
        departamento: devolucion.destino_departamento || devolucion.departamento,
        codigo_postal: devolucion.destino_codigo_postal || devolucion.codigo_postal,
        street: devolucion.direccion_entrega,
      };

      // Calcular peso estimado desde items
      const items = typeof devolucion.items === 'string' ? JSON.parse(devolucion.items) : devolucion.items;
      const pesoEstimado = items.reduce((sum, i) => sum + (i.peso_estimado_kg || 0.5) * i.cantidad, 0.5);

      // Llamar Envíame para generar etiqueta de retorno
      const enviameClient = new EnviameClient({ pool: client });
      const rates = await enviameClient.getRates({
        origin: {
          city: _ciudadToDaneCode(origenCliente.ciudad),
          state: _departamentoToDaneState(origenCliente.departamento),
          country: 'CO',
          postal_code: origenCliente.codigo_postal,
          street: origenCliente.street,
        },
        destination: {
          city: _ciudadToDaneCode(destino.ciudad),
          state: _departamentoToDaneState(destino.departamento),
          country: 'CO',
          postal_code: destino.codigo_postal,
          street: destino.street,
        },
        parcels: [{ weight: pesoEstimado, length: 20, width: 15, height: 10 }],
        value_cop: devolucion.monto_reembolso || devolucion.pedido_total || 50000,
        currency: 'COP',
      });

      // Seleccionar carrier (preferir el pasado o el más barato)
      let bestRate = rates[0];
      if (carrier_retorno) {
        bestRate = rates.find(r => r.carrier === carrier_retorno && (!service_code_retorno || r.service_code === service_code_retorno)) || rates[0];
      }

      if (!bestRate) {
        return res.status(500).json({ error: 'No hay carriers disponibles para retorno' });
      }

      const labelResult = await enviameClient.generateLabel({
        rate_id: bestRate.rate_id,
        reference: `return_${devolucionId}`,
        metadata: { devolucion_id: devolucionId, provider_id: providerId },
      });

      // Actualizar devolución con datos de retorno
      await client.query(
        `UPDATE devoluciones SET
           estado = 'ETIQUETA_GENERADA',
           etiqueta_generada_en = NOW(),
           carrier_retorno = $1,
           carrier_retorno_service_code = $2,
           guia_retorno = $3,
           guia_retorno_tracking_url = $4,
           etiqueta_retorno_pdf_url = $5,
           etiqueta_retorno_zpl = $6,
           aprobada_en = NOW(),
           aprobada_por = $7
         WHERE id = $8`,
        [
          bestRate.carrier,
          service_code_retorno || bestRate.service_code,
          labelResult.tracking_number,
          labelResult.tracking_url,
          labelResult.label_pdf_url,
          labelResult.label_zpl,
          providerId,
          devolucionId,
        ]
      );

      // Notificar al cliente
      await notificarPartesEnvio({
        guia: labelResult.tracking_number,
        eventoTipo: 'DEVOLUCION_APROBADA',
        contextoExtra: {
          devolucion_id: devolucionId,
          guia_retorno: labelResult.tracking_number,
          label_pdf_url: labelResult.label_pdf_url,
        },
      });

      res.json({
        success: true,
        data: {
          devolucion_id: devolucionId,
          guia_retorno: labelResult.tracking_number,
          tracking_url: labelResult.tracking_url,
          label_pdf_url: labelResult.label_pdf_url,
          label_zpl: labelResult.label_zpl,
          carrier: bestRate.carrier,
          service_code: bestRate.service_code,
        },
      });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/approve:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al aprobar devolución: ' + error.message });
  }
}

/**
 * POST /api/provider/returns/:id/reject
 * Proveedor rechaza devolución
 * Body: { motivo_rechazo }
 */
async function rechazarDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  if (!['provider', 'salon'].includes(req.user.role)) return res.status(403).json({ error: 'Solo proveedores y salones pueden tramitar devoluciones' });
  const devolucionId = req.params.id;
  const { motivo_rechazo } = req.body;

  if (typeof motivo_rechazo !== 'string' || motivo_rechazo.trim().length < 10) {
    return res.status(400).json({ error: 'Motivo de rechazo obligatorio (mín 10 caracteres)' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const devRes = await client.query(
        `SELECT * FROM devoluciones WHERE id = $1 AND receptor_id = $2 AND estado = 'SOLICITADA'`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada o no autorizada' });
      }

      await client.query(
        `UPDATE devoluciones SET
           estado = 'RECHAZADA',
           rechazo_motivo = $1,
           observaciones_internas = $1,
           rechazada_en = NOW(),
           rechazada_por = $2,
           tipo_resolucion = 'sin_resolucion',
           resuelta_en = NOW(), cerrada_en = NOW()
         WHERE id = $3`,
        [motivo_rechazo, providerId, devolucionId]
      );

      await client.query(
        `UPDATE devoluciones SET cerrada_en = NOW(), resuelta_en = NOW(),
           tipo_resolucion = 'sin_resolucion' WHERE id = $1`,
        [devolucionId]
      );

      // Notificar al cliente
      await notificarPartesEnvio({
        guia: `DEV-${devolucionId}`,
        eventoTipo: 'DEVOLUCION_RECHAZADA',
        contextoExtra: { devolucion_id: devolucionId, motivo_rechazo },
      });

      res.json({ success: true, data: { message: 'Devolución rechazada' } });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/reject:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al rechazar devolución' });
  }
}

/**
 * POST /api/provider/returns/:id/receive
 * Proveedor recibe e inspecciona devolución
 * Body: { inspeccion_estado: 'aprobada'|'rechazada'|'parcial', notas, fotos[], monto_reembolso_cop? }
 */
async function recibirDevolucion(req, res) {
  const providerId = req.user.id;
  const tenantId = req.user.tenant_id;
  if (!['provider', 'salon'].includes(req.user.role)) return res.status(403).json({ error: 'Solo proveedores y salones pueden inspeccionar devoluciones' });
  const devolucionId = req.params.id;
  const { inspeccion_estado, notas, fotos = [], monto_reembolso_cop } = req.body;

  if (!['aprobada', 'rechazada', 'parcial'].includes(inspeccion_estado)) {
    return res.status(400).json({ error: 'inspeccion_estado debe ser: aprobada, rechazada o parcial' });
  }

  try {
    await runInTenantTransaction({ pool }, tenantId, async (client) => {
      const devRes = await client.query(
        `SELECT d.*, pt.comprador_id, pt.total as pedido_total
         FROM devoluciones d
         JOIN pedidos_tienda pt ON pt.id = d.pedido_id
         WHERE d.id = $1 AND d.receptor_id = $2 AND d.estado IN ('ETIQUETA_GENERADA', 'ENVIADA', 'EN_TRANSITO_RETORNO')`,
        [devolucionId, providerId]
      );

      if (devRes.rows.length === 0) {
        return res.status(404).json({ error: 'Devolución no encontrada, no autorizada o no lista para recepción' });
      }

      const devolucion = devRes.rows[0];

      // Actualizar inspección
      await client.query(
        `UPDATE devoluciones SET
           inspeccion_estado = $1,
           inspeccion_notas = $2,
           inspeccion_fotos = $3,
           inspeccionada_por = $4,
           inspeccionada_en = NOW(),
           estado = CASE WHEN $1 = 'rechazada' THEN 'RECHAZADA' ELSE 'INSPECCIONADA' END,
           recibida_proveedor_en = NOW(),
           resuelta_en = CASE WHEN $1 = 'rechazada' THEN NOW() ELSE resuelta_en END,
           tipo_resolucion = CASE WHEN $1 = 'rechazada' THEN 'sin_resolucion' ELSE tipo_resolucion END
         WHERE id = $5`,
        [inspeccion_estado, notas, JSON.stringify(fotos), providerId, devolucionId]
      );
      // Si aprobada o parcial → procesar reembolso
      if (inspeccion_estado === 'aprobada' || inspeccion_estado === 'parcial') {
        const monto = Number(monto_reembolso_cop) || Number(devolucion.monto_reembolso) ||
          (inspeccion_estado === 'aprobada' ? Number(devolucion.pedido_total) : Math.round(Number(devolucion.pedido_total) * 0.5));
        
        // Hasta integrar la operación de devolución del proveedor de pagos, la
        // solicitud permanece inspeccionada y el reembolso queda pendiente.
        await client.query(
          `UPDATE devoluciones SET
             reembolso_monto_cop = $1,
             monto_reembolso = $1,
             reembolso_estado = 'pendiente',
             estado = 'INSPECCIONADA',
             tipo_resolucion = CASE WHEN $3 = 'aprobada' THEN 'reembolso_total' ELSE 'reembolso_parcial' END
           WHERE id = $2`,
          [monto, devolucionId, inspeccion_estado]
        );

        // Notificar cliente
        await notificarPartesEnvio({
          guia: devolucion.guia_retorno,
          eventoTipo: 'DEVOLUCION_RECIBIDA',
          contextoExtra: {
            devolucion_id: devolucionId,
            inspeccion_estado,
            monto_reembolso: monto,
          },
        });
      } else {
        await client.query(
          `UPDATE devoluciones SET recibida_proveedor_en = NOW(), tipo_resolucion = 'sin_resolucion'
            WHERE id = $1`,
          [devolucionId]
        );
        // Rechazada en inspección
        await notificarPartesEnvio({
          guia: devolucion.guia_retorno,
          eventoTipo: 'DEVOLUCION_RECHAZADA',
          contextoExtra: {
            devolucion_id: devolucionId,
            motivo: 'Inspección fallida: ' + notas,
          },
        });
      }

      res.json({ success: true, data: { message: 'Devolución recibida e inspeccionada' } });
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/provider/returns/:id/receive:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error al recibir devolución' });
  }
}

/**
 * Helpers (copiados de orderController para evitar circular)
 */
function _ciudadToDaneCode(ciudad) {
  const map = {
    'bogota': 11001, 'bogotá': 11001,
    'medellin': 5001, 'medellín': 5001,
    'cali': 76001,
    'barranquilla': 8001,
    'cartagena': 13001,
    'bucaramanga': 68001,
    'cucuta': 54001, 'cúcuta': 54001,
    'pereira': 66001,
    'santa marta': 47001,
    'ibague': 73001, 'ibagué': 73001,
  };
  const key = (ciudad || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return map[key] || 11001;
}

function _departamentoToDaneState(departamento) {
  const map = {
    'bogota': 'CUN', 'bogotá': 'CUN', 'cundinamarca': 'CUN',
    'antioquia': 'ANT',
    'valle del cauca': 'VAC', 'valle': 'VAC',
    'atlantico': 'ATL', 'atlántico': 'ATL',
    'bolivar': 'BOL', 'bolívar': 'BOL',
    'santander': 'SAN',
    'norte de santander': 'NSA',
    'risaralda': 'RIS',
    'magdalena': 'MAG',
    'tolima': 'TOL',
  };
  const key = (departamento || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return map[key] || 'CUN';
}

module.exports = {
  solicitarDevolucion,
  getMisDevoluciones,
  getProviderDevoluciones,
  aprobarDevolucion,
  rechazarDevolucion,
  recibirDevolucion,
};
