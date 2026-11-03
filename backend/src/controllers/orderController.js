const { pool } = require('../config/db');
const { resolverPrecio } = require('../services/precioService');
const { calcularEnvio } = require('../services/envioService');
const { insertPendingTransaction } = require('../services/transactionStore');
const { recordWebhookEvent } = require('../services/webhookEventLog');
const wompiClient = require('../services/wompiClient');
const { discriminarIva } = require('../utils/iva');

// Tarifa general de IVA. `listas_precios.incluye_iva` decide si el precio de la
// lista ya la contiene (lista `cliente`) o si hay que sumarla (negocio/profesional).
const TARIFA_IVA = 0.19;

/** URL http(s) utilizable como redirect_url (no vacia, no de otro esquema). */
function esUrlHttpValida(valor) {
  if (!valor || typeof valor !== 'string' || valor.trim().length === 0) return false;
  try {
    const url = new URL(valor.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
const dianInvoiceClient = require('../services/dianInvoiceClient');
const { cotizarEnvio } = require('../services/shippingService');

const verifyWompiSignature = (req) => {
  // Sin secreto de eventos no hay nada que verificar: se falla en CERRADO.
  // El atajo que aceptaba cualquier evento en NODE_ENV=test contradecía el
  // contrato (401 a una firma no verificable) y hacía que la compuerta mintiera.
  const headerChecksum = req.header('x-event-checksum');
  const resultado = wompiClient.verifyEventChecksum(req.body, headerChecksum);

  if (!resultado.valid) {
    console.warn(`🚨 [FINTECH SECURITY ALERT] Evento Wompi rechazado desde IP ${req.ip}: ${resultado.reason}`);
  }

  return resultado.valid;
};

// POST /api/store/checkout → Crear un nuevo pedido
exports.createOrder = async (req, res) => {
  const compradorId = req.user.id;
  const userRole = req.user.role; // 'client', 'provider', 'salon', 'admin'
  const { 
    booking_id, 
    nombre_entrega, 
    direccion_entrega, 
    items,
    // Campos estructurados de dirección (opcionales, vienen del frontend si el usuario seleccionó una dirección guardada)
    tipo_via,
    numero_principal,
    letra_principal,
    numero_secundario,
    letra_secundaria,
    complemento,
    barrio,
    ciudad,
    departamento,
    codigo_postal,
    referencia,
    direccion_entrega_id,
    // Campos del cotizador de envío (D-GL-011 v2)
    ciudad_entrega,
    peso_kg
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Se requiere una lista de productos (items)' });
  }
  if (!nombre_entrega || !direccion_entrega) {
    return res.status(400).json({ error: 'Se requiere nombre y dirección de entrega' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let prestadorComisionadoId = null;
    let tieneDescuentoReserva = false;

    // Si está asociado a una cita, validar
    if (booking_id) {
      if (userRole === 'provider') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Un prestador no puede asociar compras a una reserva' });
      }

      const bookingRes = await client.query(
        'SELECT id, provider_id, client_id FROM bookings WHERE id = $1;',
        [booking_id]
      );

      if (bookingRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Reserva no encontrada' });
      }

      const booking = bookingRes.rows[0];
      if (booking.client_id !== compradorId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'No tienes acceso a esta reserva' });
      }

      prestadorComisionadoId = booking.provider_id;
      tieneDescuentoReserva = true;
    }

    // Base neta e IVA en CENTAVOS. El precio de lista puede venir CON IVA
    // (listas_precios.incluye_iva; la lista `cliente` lo incluye). Sumarle 19 % a un
    // precio que ya lo trae cobraba de mas sobre el precio exhibido (33.880 ->
    // 40.317) y descuadraba la factura, que siempre asumio base + impuesto + envio
    // = total (generarFacturaDianPedido).
    let subtotalBaseCent = 0;
    let ivaCent = 0;
    let comisionTotal = 0;
    const processedItems = [];

    // Validar productos, resolver precios y stock
    for (const item of items) {
      const { producto_id, cantidad } = item;
      if (!producto_id || !cantidad || cantidad <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'ID de producto y cantidad válidos son obligatorios' });
      }

      // Obtener producto
      const prodRes = await client.query(
        'SELECT * FROM productos WHERE id = $1 FOR UPDATE;', // Bloqueo para concurrencia
        [producto_id]
      );

      if (prodRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Producto con ID ${producto_id} no encontrado` });
      }

      const product = prodRes.rows[0];

      // Resolver precio por nivel y validar unidad_minima ANTES de tocar stock
      let resPrecio;
      try {
        resPrecio = await resolverPrecio({
          rol: userRole,
          productoId: product.id,
          cantidad: cantidad
        });
      } catch (precioErr) {
        if (precioErr.code === 'MINIMO_NO_CUMPLIDO') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: precioErr.message,
            unidad_minima: precioErr.unidad_minima,
            lista: precioErr.lista
          });
        }
        throw precioErr;
      }

      if (!resPrecio || resPrecio.estado === 'sin_precio' || resPrecio.precio === null || resPrecio.precio === undefined) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `No tienes acceso al producto ${product.nombre}` });
      }

      // Validar stock
      if (product.stock < cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock insuficiente para ${product.nombre}. Disponible: ${product.stock}` });
      }

      const precioUnitario = resPrecio.precio;
      const comisionUnitaria = 0;

      // Restar stock
      await client.query(
        'UPDATE productos SET stock = stock - $1 WHERE id = $2;',
        [cantidad, producto_id]
      );

      // Desglose por linea: si la lista incluye IVA, el precio es el final al
      // consumidor y el impuesto se discrimina; si no, se suma sobre la base.
      const totalLineaCent = Math.round(precioUnitario * cantidad * 100);
      if (resPrecio.incluye_iva === true) {
        const { subtotalBase, ivaValor } = discriminarIva(totalLineaCent / 100, TARIFA_IVA);
        subtotalBaseCent += Math.round(subtotalBase * 100);
        ivaCent += Math.round(ivaValor * 100);
      } else {
        subtotalBaseCent += totalLineaCent;
        ivaCent += Math.round(totalLineaCent * TARIFA_IVA);
      }
      comisionTotal += comisionUnitaria * cantidad;

      processedItems.push({
        producto_id,
        cantidad,
        precio_unitario_pagado: precioUnitario,
        comision_unitaria_prestador: comisionUnitaria,
        nombre: product.nombre
      });
    }

    // Base neta e IVA del carrito. Se calculan ANTES de cotizar el envio porque el
    // umbral de envio gratis se mide contra lo que el cliente paga por los
    // productos (base + IVA), no contra la base neta.
    const subtotal = subtotalBaseCent / 100;
    const iva = ivaCent / 100;
    const totalProductos = subtotal + iva;

    // D-GL-011 v2 / D-GL-015: el envío sale de `zonas_envio` con la retención de
    // gestión de 1.000 y gratis solo por encima del umbral de la zona. Si falta
    // la dirección, el motor usa la zona más cara; nunca una constante inventada.
    const unidades = processedItems.reduce((t, item) => t + (item.cantidad || 0), 0);
    const envioDetalle = await calcularEnvio({
      client,
      ciudad: req.body.ciudad || ciudad_entrega,
      direccion: req.body.direccion_entrega || direccion_entrega,
      pesoKg: req.body.peso_total_kg || peso_kg,
      subtotal: totalProductos,
      unidades,
      entregaEnCita: tieneDescuentoReserva
    });
    const costoEnvio = envioDetalle.envio;
    const transportadoraSugerida = envioDetalle.transportadora;
    const diasEstimados = null;

    const total = totalProductos + costoEnvio;

    // ---------------------------------------------------------------------
    // tenant_id del pedido (migracion 071)
    //
    // `pedidos_tienda.tenant_id` y `detalles_pedido_tienda.tenant_id` son NOT
    // NULL desde 071 (lineas 236-268). Existe el trigger `trg_assign_tenant_id`,
    // pero solo copia `app.tenant_id` -- el contexto de sesion -- que estas rutas
    // no fijan: llegaba NULL y TODO checkout caia con 500 "null value in column
    // tenant_id of relation pedidos_tienda violates not-null constraint".
    //
    // La cabecera de 065 lo pide explicitamente: "el 100% de los INSERT declaran
    // tenant_id". Se toma del COMPRADOR, que es la MISMA regla del relleno de 071
    // (pedidos_tienda.tenant_id = usuarios.tenant_id, lineas 243-246). Un usuario
    // recien registrado puede tener el suyo NULL (056 lo creo nullable y el trigger
    // de 068 tampoco lo rellena sin contexto), asi que se cae al tenant de
    // plataforma que define 071 (app_platform_tenant_id).
    const tenantRes = await client.query(
      `SELECT COALESCE(u.tenant_id, app_platform_tenant_id()) AS tenant_id
         FROM usuarios u
        WHERE u.id = $1`,
      [compradorId]
    );
    const tenantId = tenantRes.rows[0] ? tenantRes.rows[0].tenant_id : null;

    if (tenantId === null) {
      // Sin tenant no se puede satisfacer el NOT NULL. Falla con nombre y codigo
      // propio en vez del 500 generico que no decia nada.
      const err = new Error('No se pudo determinar el tenant del comprador: usuarios.tenant_id y tenant de plataforma vacios');
      err.statusCode = 409;
      throw err;
    }

    // El estado NO se escribe aquí: lo pone el DEFAULT del esquema, que ya es
    // el correcto ('PENDIENTE_PAGO' en
    // migrations/010_implement_glowstore_schema.sql:66). Antes se metía el
    // literal 'PAGADO' en el INSERT, así que el pedido NACÍA pagado sin que
    // ninguna pasarela hubiera cobrado: la fila quedaba en la base como prueba
    // de un pago que nunca ocurrió. Un pedido solo pasa a 'PAGADO' cuando
    // existe una transacción verificada que lo respalde.
    const orderInsertRes = await client.query(
      `INSERT INTO pedidos_tienda 
        (comprador_id, rol_comprador, booking_id, prestador_comisionado_id, comision_total_prestador, subtotal, envio, iva, total, nombre_entrega, direccion_entrega,
         tipo_via, numero_principal, letra_principal, numero_secundario, letra_secundaria, complemento, barrio, ciudad, departamento, codigo_postal, referencia, direccion_entrega_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       RETURNING *;`,
      [
        compradorId,
        userRole === 'provider' ? 'PRESTADOR' : userRole === 'salon' ? 'SALON' : 'CLIENTE',
        booking_id || null,
        prestadorComisionadoId,
        comisionTotal,
        subtotal,
        costoEnvio,
        iva,
        total,
        nombre_entrega,
        direccion_entrega,
        tipo_via || null,
        numero_principal || null,
        letra_principal || null,
        numero_secundario || null,
        letra_secundaria || null,
        complemento || null,
        barrio || null,
        ciudad || null,
        departamento || null,
        codigo_postal || null,
        referencia || null,
        direccion_entrega_id || null,
        tenantId
      ]
    );

    const order = orderInsertRes.rows[0];

    // Crear los detalles del pedido
    for (const pItem of processedItems) {
      await client.query(
        `INSERT INTO detalles_pedido_tienda 
          (pedido_id, producto_id, cantidad, precio_unitario_pagado, comision_unitaria_prestador, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          order.id,
          pItem.producto_id,
          pItem.cantidad,
          pItem.precio_unitario_pagado,
          pItem.comision_unitaria_prestador,
          tenantId
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: {
        order,
        items: processedItems,
        envio: envioDetalle
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR EN CHECKOUT DE TIENDA:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Error al procesar el checkout' });
  } finally {
    client.release();
  }
};

// POST /api/store/envio/cotizacion → Desglose del pedido SIN crearlo.
// Solo lectura: no inserta pedidos, no descuenta stock y no abre transacción
// de escritura. La app lo usa para mostrar el envío y el total real antes de
// abrir la pasarela de pago.
exports.cotizarEnvio = async (req, res) => {
  const userRole = req.user.role;
  const { items, direccion_entrega, ciudad_entrega, peso_kg, booking_id } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Se requiere una lista de productos (items)' });
  }

  try {
    let entregaEnCita = false;

    // Mismas reglas que createOrder: solo el dueño de la reserva puede
    // asociarla, y una reserva válida implica entrega en la cita (sin courier).
    if (booking_id) {
      if (userRole === 'provider') {
        return res.status(400).json({ error: 'Un prestador no puede asociar compras a una reserva' });
      }

      const bookingRes = await pool.query(
        'SELECT id, client_id FROM bookings WHERE id = $1;',
        [booking_id]
      );

      if (bookingRes.rows.length === 0) {
        return res.status(404).json({ error: 'Reserva no encontrada' });
      }
      if (bookingRes.rows[0].client_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes acceso a esta reserva' });
      }

      entregaEnCita = true;
    }

    // El subtotal SIEMPRE se resuelve en el servidor con el mismo servicio que
    // usa el checkout; nunca se acepta un subtotal enviado por el cliente.
    let subtotal = 0;
    let unidades = 0;

    for (const item of items) {
      const { producto_id, cantidad } = item || {};
      const cantidadNum = Number(cantidad);
      if (!producto_id || !Number.isFinite(cantidadNum) || cantidadNum <= 0) {
        return res.status(400).json({ error: 'ID de producto y cantidad válidos son obligatorios' });
      }

      let resPrecio;
      try {
        resPrecio = await resolverPrecio({
          rol: userRole,
          productoId: producto_id,
          cantidad: cantidadNum
        });
      } catch (precioErr) {
        if (precioErr.code === 'MINIMO_NO_CUMPLIDO') {
          return res.status(400).json({
            error: precioErr.message,
            unidad_minima: precioErr.unidad_minima,
            lista: precioErr.lista
          });
        }
        throw precioErr;
      }

      if (!resPrecio || resPrecio.estado === 'sin_precio' || resPrecio.precio === null || resPrecio.precio === undefined) {
        return res.status(403).json({ error: `No hay precio disponible para el producto ${producto_id}` });
      }

      subtotal += resPrecio.precio * cantidadNum;
      unidades += cantidadNum;
    }

    const envioDetalle = await calcularEnvio({
      client: pool,
      ciudad: ciudad_entrega,
      direccion: direccion_entrega,
      pesoKg: peso_kg,
      subtotal,
      unidades,
      entregaEnCita
    });

    // Misma convención que createOrder: el precio de lista incluye IVA.
    // `subtotal` sale como base neta (lo que se guarda en pedidos_tienda.subtotal)
    // y `subtotal_con_iva` como el valor de vitrina. Antes la cotización devolvía el
    // bruto en `subtotal` y el pedido guardaba la base: la pantalla mostraba 30.000
    // y la fila decía 25.210, que es el descuadre que esta prueba vigila.
    const iva = Math.round(subtotal - subtotal / 1.19);
    const baseNeta = subtotal - iva;
    const total = subtotal + envioDetalle.envio;

    res.json({
      success: true,
      data: {
        subtotal: baseNeta,
        subtotal_con_iva: subtotal,
        iva,
        envio: envioDetalle.envio,
        total,
        envio_detalle: envioDetalle
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN COTIZACIÓN DE ENVÍO:', error);
    res.status(500).json({ error: 'Error al cotizar el envío' });
  }
};

// GET /api/store/orders → Obtener pedidos del usuario logueado
exports.getOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query = '';
    const params = [userId];

    if (userRole === 'provider') {
      // Un prestador ve sus compras y también las ventas que debe entregar
      query = `
        SELECT DISTINCT pt.* 
        FROM pedidos_tienda pt
        WHERE pt.comprador_id = $1 OR pt.prestador_comisionado_id = $1
        ORDER BY pt.creado_en DESC;
      `;
    } else if (userRole === 'salon') {
      // Un salón ve sus compras (como cliente)
      query = `
        SELECT pt.* 
        FROM pedidos_tienda pt
        WHERE pt.comprador_id = $1
        ORDER BY pt.creado_en DESC;
      `;
    } else if (userRole === 'admin') {
      // Admin ve todo
      query = `
        SELECT pt.* 
        FROM pedidos_tienda pt
        ORDER BY pt.creado_en DESC;
      `;
      // Limpiar params para admin ya que no filtra por ID de comprador por defecto
      params.pop();
    } else {
      // Cliente normal solo ve sus propias compras
      query = `
        SELECT pt.* 
        FROM pedidos_tienda pt
        WHERE pt.comprador_id = $1
        ORDER BY pt.creado_en DESC;
      `;
    }

    const { rows } = await pool.query(query, params);

    res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/store/orders:', error);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
};

// GET /api/store/orders/:id → Obtener detalle de un pedido específico
exports.getOrderById = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Obtener cabecera
    const orderRes = await pool.query(
      'SELECT * FROM pedidos_tienda WHERE id = $1;',
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const order = orderRes.rows[0];

    // Validar propiedad de visualización
    if (
      userRole !== 'admin' &&
      order.comprador_id !== userId &&
      order.prestador_comisionado_id !== userId
    ) {
      return res.status(403).json({ error: 'No autorizado para ver este pedido' });
    }

    // Obtener detalles
    const detailsRes = await pool.query(
      `SELECT dpt.*, p.nombre, p.imagen_url, p.tag_especialidad 
       FROM detalles_pedido_tienda dpt
       JOIN productos p ON dpt.producto_id = p.id
       WHERE dpt.pedido_id = $1;`,
      [orderId]
    );

    // Estado del cobro. Sin esto la app solo ve el estado del PEDIDO, que sigue en
    // PENDIENTE_PAGO tanto si el pago fue rechazado como si aun no ha llegado el
    // webhook: no puede distinguir "espera" de "fallo", y el cliente no se entera.
    const wompiExternalId = order.metadata && order.metadata.wompi_external_id
      ? order.metadata.wompi_external_id
      : null;
    let pago = null;
    if (wompiExternalId) {
      const txRes = await pool.query(
        'SELECT status, estado_pago, external_id FROM transactions WHERE external_id = $1 ORDER BY id DESC LIMIT 1;',
        [wompiExternalId]
      );
      if (txRes.rows.length > 0) pago = txRes.rows[0];
    }

    res.json({
      success: true,
      data: {
        order,
        items: detailsRes.rows,
        pago
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/store/orders/:id:', error);
    res.status(500).json({ error: 'Error al obtener detalle del pedido' });
  }
};

// 🔹 POST /api/store/orders/:id/pay — Pagar un pedido de tienda
// Mismo contrato que payBooking: crea transacción, exige acceptance_token y payment_method/phoneNumber
exports.payOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.id;
    const {
      payment_method, phone_number, payment_source_id, payment_method_token,
      installments, acceptance_token, redirect_url, customer_data
    } = req.body;

    // Validar pedido
    const orderRes = await pool.query('SELECT * FROM pedidos_tienda WHERE id = $1;', [orderId]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const order = orderRes.rows[0];

    // Verificar propiedad
    if (order.comprador_id !== userId) {
      return res.status(403).json({ error: 'No autorizado para pagar este pedido' });
    }

    if (order.estado !== 'PENDIENTE_PAGO') {
      return res.status(400).json({ error: `El pedido ya está en estado ${order.estado}` });
    }

    // Un pedido no se cobra dos veces. Si ya hay una transaccion pendiente de este
    // pedido (doble clic, reintento con red lenta), se rechaza aqui en vez de crear
    // una segunda transaccion en Wompi: el cliente podia acabar con dos cobros, y el
    // metadata (que guarda un solo external_id) dejaba el pedido sin cerrar.
    // La ventana de 15 min evita que un intento abandonado bloquee el pedido.
    const pendienteRes = await pool.query(
      `SELECT id FROM transactions
        WHERE starts_with(referencia_pasarela, 'wompi_order_' || $1::text || '_')
          AND status = 'pending'
          AND created_en > NOW() - INTERVAL '15 minutes'
        LIMIT 1;`,
      [orderId]
    );
    if (pendienteRes.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya hay un pago en curso para este pedido: espera la confirmación antes de reintentar.',
        data: { transaction_id: pendienteRes.rows[0].id }
      });
    }

    // Validar instrumento de pago
    const validPaymentMethods = [
      'NEQUI', 'CARD', 'PSE', 'BANCOLOMBIA_TRANSFER', 'DAVIPLATA',
      'BANCO_DE_BOGOTA_TRANSFER', 'BANCO_DE_OCCIDENTE_TRANSFER',
      'BANCO_AV_VILLAS_TRANSFER', 'BANCO_POPULAR_TRANSFER', 'BANCO_PICHINCHA_TRANSFER'
    ];
    if (!payment_method || !validPaymentMethods.includes(payment_method.toUpperCase())) {
      return res.status(400).json({ 
        error: `Método de pago inválido. Válidos: ${validPaymentMethods.join(', ')}` 
      });
    }
    if (!acceptance_token || String(acceptance_token).trim().length === 0) {
      return res.status(400).json({ error: 'acceptance_token es obligatorio (Habeas Data).' });
    }
    
    const method = payment_method.toUpperCase();
    
    // NEQUI: o una fuente de pago (payment_source_id) o el telefono
    if (method === 'NEQUI' && !payment_source_id
        && (!phone_number || String(phone_number).trim().length === 0)) {
      return res.status(400).json({ error: 'phone_number es obligatorio para pagos Nequi.' });
    }
    
    // CARD: o una fuente de pago o un token de POST /tokens/cards
    if (method === 'CARD' && !payment_method_token
        && (!payment_source_id || String(payment_source_id).trim().length === 0)) {
      return res.status(400).json({ error: 'payment_source_id es obligatorio para pagos con tarjeta (fuente tokenizada).' });
    }
    
    // PSE y transferencias bancarias requieren redirect_url y customer_data
    const redirectMethods = [
      'PSE', 'BANCOLOMBIA_TRANSFER', 'DAVIPLATA',
      'BANCO_DE_BOGOTA_TRANSFER', 'BANCO_DE_OCCIDENTE_TRANSFER',
      'BANCO_AV_VILLAS_TRANSFER', 'BANCO_POPULAR_TRANSFER', 'BANCO_PICHINCHA_TRANSFER'
    ];
    if (redirectMethods.includes(method)) {
      // Para métodos redirect, se necesita redirect_url y customer_data
      // `.trim().isEmpty` es sintaxis DART: en JS `.isEmpty` es undefined, asi que
      // una URL de solo espacios pasaba y Wompi respondia 402. Se valida de verdad.
      if (!esUrlHttpValida(redirect_url)) {
        return res.status(400).json({ error: 'redirect_url debe ser una URL http(s) válida para métodos de redirección (PSE, transferencias).' });
      }
      if (!customer_data || !customer_data.email || !customer_data.full_name || !customer_data.phone_number) {
        return res.status(400).json({ error: 'customer_data (email, full_name, phone_number) es obligatorio para métodos de redirección.' });
      }
      if (method === 'PSE' && !customer_data.financial_institution_code) {
        return res.status(400).json({ error: 'customer_data.financial_institution_code es obligatorio para métodos de redirección.' });
      }
    }

    // Verificar monto
    const expectedAmount = parseFloat(order.total);
    if (isNaN(expectedAmount) || expectedAmount <= 0) {
      return res.status(500).json({ error: 'Total del pedido inválido.' });
    }

    // Crear transacción en estado PENDING (el webhook la confirmará)
    const externalId = 'wompi_order_' + orderId + '_' + Date.now();

    // Preparar datos para Wompi según el método
    // Contrato de Wompi, identico al de payBooking (bookingController.js:84-96):
    //  - NEQUI con fuente de pago -> payment_source_id
    //  - NEQUI con telefono      -> payment_method = { type:'NEQUI', phone_number }
    //  - CARD con fuente de pago -> payment_source_id
    //  - CARD con token          -> payment_method = { type:'CARD', token, installments }
    //  - PSE / transferencias    -> payment_method = <string del metodo> + customer_data + redirect_url
    // Wompi exige EXACTAMENTE uno de payment_source_id o payment_method.
    let paymentSourceId = null;
    let paymentMethodPayload = null;

    if (method === 'NEQUI') {
      if (payment_source_id) paymentSourceId = payment_source_id;
      else paymentMethodPayload = { type: 'NEQUI', phone_number };
    } else if (method === 'CARD') {
      if (payment_source_id) paymentSourceId = payment_source_id;
      else paymentMethodPayload = {
        type: 'CARD',
        token: payment_method_token,
        installments: installments || 1
      };
    } else if (redirectMethods.includes(method)) {
      paymentMethodPayload = method;
    }

    const wompiTransactionData = {
      amountInCents: Math.round(expectedAmount * 100),
      currency: 'COP',
      reference: externalId,
      customerEmail: req.user.email || 'cliente@glowapp.co',
      acceptanceToken: acceptance_token,
      paymentSourceId,
      customerData: redirectMethods.includes(method) ? customer_data : null,
      redirectUrl: redirectMethods.includes(method) ? redirect_url : null,
      ip: req.ip || null,
      auth: 'private'
    };
    if (paymentMethodPayload) {
      wompiTransactionData.paymentMethod = paymentMethodPayload;
    }
    if (redirectMethods.includes(method) && !wompiTransactionData.customerEmail) {
      wompiTransactionData.customerEmail = customer_data.email;
    }

    const wompiClient = require('../services/wompiClient');
    const wompiTx = await wompiClient.createTransaction(wompiTransactionData);

    // Guardar transacción local. `insertPendingTransaction` escribe tenant_id:
    // `transactions` tiene RLS FORCE, así que una fila sin tenant queda invisible
    // para cualquier rol que no sea superusuario.
    const transaction = await insertPendingTransaction(pool, {
      userId,
      amount: expectedAmount,
      method,
      wompiId: wompiTx.id,
      reference: externalId,
      tenantId: order.tenant_id,
    });

    // El webhook localiza el pedido con `metadata->>'wompi_external_id' = <data.id de Wompi>`,
    // asi que ahi va el id de la transaccion; la referencia se guarda aparte para trazabilidad.
    await pool.query(
      // to_jsonb() es POLIMORFICA: con un parametro sin tipo Postgres responde
      // "could not determine polymorphic type because input has type unknown".
      // El cast ::text fija el tipo de entrada.
      `UPDATE pedidos_tienda
          SET metadata = jsonb_set(
                jsonb_set(COALESCE(metadata, '{}'::jsonb), '{wompi_external_id}', to_jsonb($2::text)),
                '{wompi_reference}', to_jsonb($3::text))
        WHERE id = $1;`,
      [orderId, wompiTx.id, externalId]
    );

    // Responder 202: la transacción se inició, el webhook confirma
    res.status(202).json({
      success: true,
      data: {
        transaction_id: transaction.id,
        external_id: externalId,
        amount: expectedAmount,
        status: 'pending',
        payment_method: method,
        // PSE / transferencias: el usuario debe abrir esta URL para autorizar el cobro.
        async_payment_url: wompiTx.asyncPaymentUrl || null,
        message: redirectMethods.includes(method)
          ? 'Transacción iniciada. Abre la URL de redirección para autorizar el pago.'
          : 'Transacción iniciada. El webhook de Wompi confirmará el pago.'
      }
    });

  } catch (error) {
    console.error('❌ ERROR EN POST /api/store/orders/:id/pay:', error);
    // Mismo mapeo que payBooking: un 4xx de Wompi no es culpa del servidor (402)
    // y una caida de red tampoco (502). El 500 se reserva para fallos propios.
    const detalle = error?.body?.error?.messages || error?.message || 'error desconocido';
    const esRed = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.cause?.code)
      || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code);
    const status = esRed ? 502
      : (error?.status && error.status >= 400 && error.status < 500 ? 402 : 500);
    res.status(status).json({
      error: status === 402 ? 'WOMPI_TRANSACTION_FAILED' : 'Error al iniciar el pago del pedido',
      message: status === 402
        ? 'Wompi rechazo la creacion de la transaccion. No se realizo ningun cobro.'
        : 'Error al iniciar el pago del pedido',
      detalle
    });
  }
};

// 🔹 POST /api/payments/store-webhook — Webhook de Wompi para pedidos de tienda
exports.storeWebhook = async (req, res) => {
  try {
    if (!verifyWompiSignature(req)) {
      return res.status(401).json({ error: 'Invalid event signature' });
    }

    const event = req.body;
    // Wompi manda `event` como STRING ("transaction.updated"), no como objeto
    // (docs.wompi.co -> Eventos -> Cuerpo de un evento). Leer `event.event.type`
    // daba undefined y este handler respondia 400 a TODO evento real: Wompi
    // reintentaba 3 veces y el pedido no se cerraba nunca.
    const eventType = typeof event?.event === 'string'
      ? event.event
      : (event?.event?.type || event?.type);
    const data = event?.data?.transaction || event?.data || event;

    // Registro en `webhook_events`: un evento de pasarela sin fila es un pago que
    // no se puede auditar. Se usa el pool (no la conexión de la transacción de
    // dinero) para que el registro sobreviva a un ROLLBACK, y nunca tumba la
    // petición: si falla, se avisa y se sigue.
    // `event_id` es el id de la transacción en Wompi: el mismo en todos los
    // reintentos, así el UNIQUE(provider, event_id) mantiene una sola fila.
    const eventIdWompi = event?.data?.transaction?.id || (event?.data && event.data.id) || null;
    const registrarEvento = (resultado, errorMessage = null) =>
      recordWebhookEvent(pool, {
        provider: 'wompi',
        eventId: eventIdWompi,
        eventType: eventType || 'desconocido',
        payload: event,
        result: resultado,
        errorMessage,
      }).catch((e) =>
        console.error('⚠️ No se pudo registrar el evento en webhook_events:', e.message)
      );

    if (!eventType || !data) {
      await registrarEvento({ estado: 'invalido', motivo: 'sin event o data' });
      return res.status(400).json({ error: 'Evento Wompi inválido' });
    }

    // Solo procesar transaction.updated / transaction.approved / transaction.declined
    if (!['transaction.updated', 'transaction.approved', 'transaction.declined'].includes(eventType)) {
      await registrarEvento({ estado: 'ignorado', motivo: 'tipo no relevante', tipo: eventType });
      return res.json({ success: true });
    }

    const externalId = data.id || data.external_id;
    const reference = data.reference || null;
    const status = data.status;
    const amount = data.amount_in_cents ? data.amount_in_cents / 100 : data.amount;

    if (!externalId) {
      console.warn('⚠️ Webhook store sin external_id');
      await registrarEvento({ estado: 'ignorado', motivo: 'sin external_id' });
      return res.json({ success: true });
    }

    // Todo el trabajo va en UNA conexion con BEGIN/COMMIT. Antes se hacia
    // pool.query('BEGIN') sobre el POOL: cada query puede salir por una conexion
    // distinta, asi que la transaccion no envolvia nada y un fallo a mitad dejaba
    // la transaccion en 'paid' con el pedido sin cerrar (F7).
    const client = await pool.connect();
    let pedidoPagadoId = null;
    try {
      await client.query('BEGIN');

      // FOR UPDATE: dos entregas concurrentes del mismo evento se serializan; la
      // segunda ya ve el estado final y no repite trabajo (ni factura).
      // external_id guarda el id de Wompi; referencia_pasarela, la referencia
      // (wompi_order_<pedido>_<ts>). Son valores DISTINTOS: el cobro puede estar
      // registrado solo con la referencia si se inserto antes de crear la
      // transaccion, y el evento trae ambos.
      const txRes = await client.query(
        'SELECT * FROM transactions WHERE external_id = $1 OR referencia_pasarela = $2 FOR UPDATE;',
        [externalId, reference]
      );

      if (txRes.rows.length === 0) {
        await client.query('ROLLBACK');
        console.warn(`⚠️ Transacción no encontrada para external_id ${externalId}`);
        // Si la referencia es de un pedido NUESTRO, el cobro puede existir sin
        // registro local: hay que pedirle a Wompi que reintente. Para el resto
        // (eventos ajenos, sondas) un 200 evita 24 h de reintentos inutiles.
        const esPedidoPropio = /^wompi_order_/.test(String(reference || ''));
        await registrarEvento(
          { estado: 'sin_transaccion', external_id: externalId, referencia: reference },
          'Transacción de pedido no registrada'
        );
        if (esPedidoPropio) {
          return res.status(500).json({ error: 'Transacción de pedido no registrada; reintentar' });
        }
        return res.json({ success: true });
      }

      const tx = txRes.rows[0];

      if (status === 'APPROVED') {
        // Idempotencia: se evalua DENTRO de la transaccion y con la fila bloqueada.
        if (tx.status === 'paid') {
          await client.query('COMMIT');
          await registrarEvento({ estado: 'duplicado', external_id: externalId, motivo: 'ya estaba pagada' });
          return res.json({ success: true });
        }

        // Monto: igualdad exacta en centavos y moneda COP. Antes bastaba con que
        // fuera MAYOR al esperado, y ademas se sobrescribia monto_total con lo
        // pagado, borrando el valor esperado del pedido.
        const moneda = data.currency || tx.currency || 'COP';
        if (moneda !== 'COP') {
          throw new Error(`Moneda del pago (${moneda}) distinta de COP`);
        }
        if (Math.round(parseFloat(amount) * 100) !== Math.round(parseFloat(tx.monto_total) * 100)) {
          throw new Error(`Monto pagado (${amount}) distinto al esperado (${tx.monto_total})`);
        }

        await client.query(
          `UPDATE transactions SET status = 'paid', estado_pago = 'paid' WHERE id = $1;`,
          [tx.id]
        );

        const orderRes = await client.query(
          `SELECT * FROM pedidos_tienda WHERE metadata->>'wompi_external_id' = $1 FOR UPDATE;`,
          [externalId]
        );

        // Dinero cobrado sin pedido: no se puede cerrar en silencio. Se revierte
        // todo y se responde 500 para que Wompi reintente y quede la alerta.
        if (orderRes.rows.length === 0) {
          throw new Error(`Pago aprobado sin pedido asociado (external_id ${externalId}); requiere revisión`);
        }

        const order = orderRes.rows[0];
        // Solo un pedido PENDIENTE_PAGO pasa a PAGADO. Si el admin lo cancelo
        // mientras el pago viajaba, el cobro existe: se alerta para reembolso en
        // vez de revivir un pedido cancelado.
        const actualizado = await client.query(
          `UPDATE pedidos_tienda SET estado = 'PAGADO' WHERE id = $1 AND estado = 'PENDIENTE_PAGO';`,
          [order.id]
        );

        if (actualizado.rowCount === 0) {
          console.error(
            `🚨 [STORE WEBHOOK] Pago APROBADO sobre pedido ${order.id} en estado ${order.estado}: NO se marco PAGADO. Reembolso manual requerido (external_id ${externalId}).`
          );
        } else {
          pedidoPagadoId = order.id;
        }

        await client.query('COMMIT');
        if (pedidoPagadoId) {
          console.log(`✅ [STORE WEBHOOK] Pedido ${pedidoPagadoId} marcado PAGADO`);
        }
      } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(status)) {
        // Un evento fuera de orden no puede degradar un pago ya confirmado.
        await client.query(
          `UPDATE transactions SET status = 'failed', estado_pago = 'failed' WHERE id = $1 AND status <> 'paid';`,
          [tx.id]
        );
        await client.query('COMMIT');
        console.log(`⚠️ [STORE WEBHOOK] Transacción ${externalId} en ${status}`);
      } else {
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // La factura va FUERA de la transaccion: si falla, el cobro ya esta confirmado
    // y la factura se puede reintentar sin deshacer el pago.
    if (pedidoPagadoId) {
      try {
        await generarFacturaDianPedido(pedidoPagadoId);
      } catch (invoiceError) {
        console.error(`❌ [DIAN INVOICE] Error generando factura para pedido ${pedidoPagadoId}:`, invoiceError.message);
      }
    }

    await registrarEvento({
      estado: pedidoPagadoId ? 'pedido_pagado' : 'procesado',
      pedido: pedidoPagadoId,
      status_wompi: status,
      external_id: externalId,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ ERROR EN /api/payments/store-webhook:', error);
    // El registro va aquí y no por el helper: `eventType` y `externalId` viven
    // dentro del try, así que en el catch no están en alcance.
    const cuerpo = req.body || {};
    const tipoError = typeof cuerpo.event === 'string'
      ? cuerpo.event
      : (cuerpo?.event?.type || cuerpo?.type || 'desconocido');
    await recordWebhookEvent(pool, {
      provider: 'wompi',
      eventId: cuerpo?.data?.transaction?.id || cuerpo?.data?.id || null,
      eventType: tipoError,
      payload: cuerpo,
      result: { estado: 'error' },
      errorMessage: error.message,
    }).catch((e) => console.error('⚠️ No se pudo registrar el evento fallido:', e.message));
    res.status(500).json({ error: 'Error al procesar webhook' });
  }
};

/**
 * Genera y envía la Factura Electrónica DIAN para un pedido de tienda pagado.
 */
async function generarFacturaDianPedido(pedidoId) {
  if (!dianInvoiceClient.isConfigured()) {
    console.info(`[DIAN INVOICE] Cliente no configurado (falta certificado/NIT). Saltando factura para pedido ${pedidoId}.`);
    return;
  }

  // Obtener datos del pedido con detalles
  const orderRes = await pool.query(
    `SELECT pt.*, u.id as comprador_id, u.email as comprador_email, u.first_name, u.last_name, u.document_number, u.document_type, u.phone, u.address
     FROM pedidos_tienda pt
     JOIN usuarios u ON pt.comprador_id = u.id
     WHERE pt.id = $1;`,
    [pedidoId]
  );

  if (orderRes.rows.length === 0) {
    throw new Error(`Pedido ${pedidoId} no encontrado para facturación`);
  }

  const order = orderRes.rows[0];

  // Obtener detalles del pedido
  const detailsRes = await pool.query(
    `SELECT dpt.*, p.nombre, p.tag_especialidad
     FROM detalles_pedido_tienda dpt
     JOIN productos p ON dpt.producto_id = p.id
     WHERE dpt.pedido_id = $1;`,
    [pedidoId]
  );

  // Datos del emisor
  const emisorNit = process.env.DIAN_NIT;
  const emisorDv = process.env.DIAN_DV || '0';
  const emisorRazonSocial = process.env.DIAN_RAZON_SOCIAL || 'GlowApp S.A.S.';
  const emisorDireccion = process.env.DIAN_DIRECCION || 'Calle 100 # 7-21';
  const emisorMunicipio = process.env.DIAN_MUNICIPIO || '11001';
  const emisorDepartamento = process.env.DIAN_DEPARTAMENTO || '11';
  const emisorTelefono = process.env.DIAN_TELEFONO || '+57 1 234 5678';
  const emisorEmail = process.env.DIAN_EMAIL || 'facturacion@glowapp.co';
  const emisorRutResponsabilidades = [48];

  // Calcular desglose IVA
  const subtotal = parseFloat(order.subtotal) || parseFloat(order.total) / 1.19;
  const totalImpuestos = parseFloat(order.iva) || (parseFloat(order.total) - subtotal);
  const totalFactura = parseFloat(order.total);

  // Preparar líneas
  const lineas = detailsRes.rows.map((item, index) => ({
    cantidad: item.cantidad,
    unidad: '94',
    descripcion: item.nombre || 'Producto GlowStore',
    valorUnitario: parseFloat(item.precio_unitario),
    ivaPorcentaje: item.iva_porcentaje || 19,
    codigo: item.producto_id
  }));

  const now = new Date();
  const fechaEmision = now.toISOString().split('T')[0];
  const horaEmision = now.toTimeString().split(' ')[0];

  // Generar XML UBL 2.1
  const xmlFirmado = await dianInvoiceClient.generarFacturaXml({
    numeroFactura: `FAC-STORE-${pedidoId}`,
    fechaEmision,
    horaEmision,
    tipoFactura: '01',
    metodoPago: '1',
    formaPago: '1',
    moneda: 'COP',
    tipoOperacion: '10',

    // Emisor
    emisorNit,
    emisorDv,
    emisorRazonSocial,
    emisorDireccion,
    emisorMunicipio,
    emisorDepartamento,
    emisorTelefono,
    emisorEmail,
    emisorRutResponsabilidades,

    // Adquiriente
    adquirienteTipoDoc: order.document_type === 'CC' ? 13 : 31,
    adquirienteNumeroDoc: order.document_number,
    adquirienteDv: order.document_dv || '0',
    adquirienteRazonSocial: `${order.first_name} ${order.last_name}`,
    adquirienteDireccion: order.address || 'Sin dirección',
    adquirienteMunicipio: order.city_code || '11001',
    adquirienteDepartamento: order.state_code || '11',
    adquirienteTelefono: order.phone || 'N/A',
    adquirienteEmail: order.comprador_email,

    // Líneas y totales
    lineas,
    subtotal,
    totalDescuentos: parseFloat(order.descuento) || 0,
    totalCargos: parseFloat(order.cargo_envio) || 0,
    totalImpuestos,
    totalFactura,

    observaciones: `Pedido GlowStore ${pedidoId}`
  });

  // Enviar a DIAN / Proveedor
  const resultado = await dianInvoiceClient.enviarFactura(xmlFirmado, `FAC-STORE-${pedidoId}`);

  if (!resultado.aceptada) {
    throw new Error(`Factura rechazada por DIAN: ${JSON.stringify(resultado.respuesta)}`);
  }

  // Guardar CUFE y QR en el pedido
  await pool.query(
    `UPDATE pedidos_tienda SET 
       cufe = $2, 
       qr_factura = $3, 
       factura_emitida = true, 
       factura_fecha = $4 
     WHERE id = $1;`,
    [pedidoId, resultado.cufe, resultado.qr, new Date()]
  );

  console.log(`✅ [DIAN INVOICE] Factura emitida para pedido ${pedidoId} - CUFE: ${resultado.cufe}`);
}

/**
 * POST /api/admin/store/orders/:id/dispatch — Marcar pedido como DESPACHADO (solo admin)
 * Body: { transportadora, guia, url_rastreo, observaciones }
 */
async function dispatchOrder(req, res) {
  try {
    const orderId = req.params.id;
    const { transportadora, guia, url_rastreo, observaciones } = req.body;

    // Validar campos obligatorios
    if (!transportadora || !transportadora.trim()) {
      return res.status(400).json({ error: 'transportadora es obligatoria' });
    }
    if (!guia || !guia.trim()) {
      return res.status(400).json({ error: 'guia (número de guía) es obligatoria' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar pedido y estado actual
      const orderRes = await client.query('SELECT * FROM pedidos_tienda WHERE id = $1;', [orderId]);
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const order = orderRes.rows[0];

      if (order.estado !== 'PAGADO') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `El pedido debe estar PAGADO para despachar. Estado actual: ${order.estado}` });
      }

      // Actualizar pedido a DESPACHADO con timestamp
      await client.query(
        `UPDATE pedidos_tienda SET estado = 'DESPACHADO', despachado_en = NOW() WHERE id = $1;`,
        [orderId]
      );

      // Crear registro en tabla envios
      const envioRes = await client.query(
        `INSERT INTO envios (pedido_id, transportadora, guia, url_rastreo, estado, observaciones)
         VALUES ($1, $2, $3, $4, 'CREADO', $5)
         RETURNING *;`,
        [orderId, transportadora, guia, url_rastreo || null, observaciones || null]
      );

      await client.query('COMMIT');

      console.log(`✅ [ADMIN DISPATCH] Pedido ${orderId} despachado vía ${transportadora} guía ${guia}`);

      res.json({
        success: true,
        data: {
          order: { ...order, estado: 'DESPACHADO', despachado_en: new Date() },
          envio: envioRes.rows[0]
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR EN POST /api/admin/store/orders/:id/dispatch:', error);
    res.status(500).json({ error: 'Error al despachar el pedido' });
  }
}

/**
 * POST /api/admin/store/orders/:id/deliver — Marcar pedido como ENTREGADO (solo admin)
 * Body: { observaciones }
 * Alternativa: PATCH /api/admin/envios/:guia/deliver
 */
async function deliverOrder(req, res) {
  try {
    const orderId = req.params.id;
    const { observaciones } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar pedido y estado actual
      const orderRes = await client.query('SELECT * FROM pedidos_tienda WHERE id = $1;', [orderId]);
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const order = orderRes.rows[0];

      if (!['DESPACHADO', 'PAGADO'].includes(order.estado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `El pedido debe estar DESPACHADO (o PAGADO) para marcar como entregado. Estado actual: ${order.estado}` });
      }

      // Actualizar pedido a ENTREGADO con timestamp
      await client.query(
        `UPDATE pedidos_tienda SET estado = 'ENTREGADO', entregado_en = NOW() WHERE id = $1;`,
        [orderId]
      );

      // Actualizar envío a ENTREGADO
      await client.query(
        `UPDATE envios SET estado = 'ENTREGADO', entregado_en = NOW(), observaciones = COALESCE($2, observaciones)
         WHERE pedido_id = $1;`,
        [orderId, observaciones || null]
      );

      await client.query('COMMIT');

      console.log(`✅ [ADMIN DELIVER] Pedido ${orderId} marcado ENTREGADO`);

      res.json({
        success: true,
        data: { order: { ...order, estado: 'ENTREGADO', entregado_en: new Date() } }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR EN POST /api/admin/store/orders/:id/deliver:', error);
    res.status(500).json({ error: 'Error al marcar pedido como entregado' });
  }
}

/**
 * POST /api/admin/store/orders/:id/cancel — Cancelar pedido (solo admin)
 * Body: { motivo }
 */
async function cancelOrder(req, res) {
  try {
    const orderId = req.params.id;
    const { motivo } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query('SELECT * FROM pedidos_tienda WHERE id = $1;', [orderId]);
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const order = orderRes.rows[0];

      if (['ENTREGADO', 'CANCELADO'].includes(order.estado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No se puede cancelar un pedido en estado ${order.estado}` });
      }

      // Si estaba pagado, crear transacción de reembolso (stub)
      if (order.estado === 'PAGADO' || order.estado === 'DESPACHADO') {
        console.warn(`⚠️ [ADMIN CANCEL] Pedido ${orderId} cancelado tras pago/despacho — requiere reembolso manual`);
      }

      // Actualizar pedido a CANCELADO
      await client.query(
        `UPDATE pedidos_tienda SET estado = 'CANCELADO', cancelado_en = NOW() WHERE id = $1;`,
        [orderId]
      );

      // Cancelar envío si existe
      await client.query(
        `UPDATE envios SET estado = 'DEVUELTO', observaciones = COALESCE($2, observaciones) WHERE pedido_id = $1;`,
        [orderId, motivo || 'Cancelado por admin']
      );

      await client.query('COMMIT');

      console.log(`✅ [ADMIN CANCEL] Pedido ${orderId} cancelado`);

      res.json({
        success: true,
        data: { order: { ...order, estado: 'CANCELADO', cancelado_en: new Date() } }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR EN POST /api/admin/store/orders/:id/cancel:', error);
    res.status(500).json({ error: 'Error al cancelar el pedido' });
  }
}

/**
 * GET /api/admin/store/orders — Listar todos los pedidos (admin)
 * Query: estado, desde, hasta, page, limit
 */
async function getAllStoreOrdersAdmin(req, res) {
  try {
    const { estado, desde, hasta, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];
    let paramIdx = 1;

    if (estado) {
      where += ` AND pt.estado = $${paramIdx++}`;
      params.push(estado.toUpperCase());
    }
    if (desde) {
      where += ` AND pt.creado_en >= $${paramIdx++}`;
      params.push(desde);
    }
    if (hasta) {
      where += ` AND pt.creado_en <= $${paramIdx++}`;
      params.push(hasta);
    }

    params.push(parseInt(limit), offset);

    const query = `
      SELECT pt.*, u.email as comprador_email, u.first_name, u.last_name
      FROM pedidos_tienda pt
      JOIN usuarios u ON pt.comprador_id = u.id
      WHERE ${where}
      ORDER BY pt.creado_en DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++};
    `;

    const countQuery = `
      SELECT COUNT(*) FROM pedidos_tienda pt WHERE ${where};
    `;

    const [dataRes, countRes] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, paramIdx - 3))
    ]);

    res.json({
      success: true,
      count: dataRes.rows.length,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      data: dataRes.rows
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/store/orders:', error);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
}

/**
 * GET /api/admin/envios/:guia — Obtener tracking de envío
 */
async function getEnvioByGuia(req, res) {
  try {
    const { guia } = req.params;
    const resEnvio = await pool.query(
      `SELECT e.*, pt.estado as pedido_estado, pt.total, pt.nombre_entrega, pt.direccion_entrega
       FROM envios e
       JOIN pedidos_tienda pt ON e.pedido_id = pt.id
       WHERE e.guia = $1;`,
      [guia]
    );
    if (resEnvio.rows.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }
    res.json({ success: true, data: resEnvio.rows[0] });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/envios/:guia:', error);
    res.status(500).json({ error: 'Error al obtener envío' });
  }
}

/**
 * PATCH /api/admin/envios/:guia/status — Actualizar estado de envío (webhook transportadora o manual)
 * Body: { estado, observaciones }
 */
async function updateEnvioStatus(req, res) {
  try {
    const { guia } = req.params;
    const { estado, observaciones } = req.body;

    const validEstados = ['CREADO', 'RECOGIDO', 'EN_TRANSITO', 'EN_CENTRO_DESTINO', 'SALIDA_ENTREGA', 'ENTREGADO', 'FALLIDO', 'DEVUELTO'];
    if (!validEstados.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Válidos: ${validEstados.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const envioRes = await client.query('SELECT * FROM envios WHERE guia = $1;', [guia]);
      if (envioRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Envío no encontrado' });
      }

      const updateFields = ['estado = $2', 'actualizado_en = NOW()'];
      const updateParams = [guia, estado];
      let paramIdx = 3;

      if (estado === 'ENTREGADO') {
        updateFields.push(`entregado_en = NOW()`);
      }
      if (observaciones) {
        updateFields.push(`observaciones = $${paramIdx++}`);
        updateParams.push(observaciones);
      }

      await client.query(
        `UPDATE envios SET ${updateFields.join(', ')} WHERE guia = $1;`,
        updateParams
      );

      // Si ENTREGADO, también marcar pedido
      if (estado === 'ENTREGADO') {
        await client.query(
          `UPDATE pedidos_tienda SET estado = 'ENTREGADO', entregado_en = NOW() WHERE id = (SELECT pedido_id FROM envios WHERE guia = $1);`,
          [guia]
        );
      }

      await client.query('COMMIT');

      res.json({ success: true, data: { guia, estado } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/envios/:guia/status:', error);
    res.status(500).json({ error: 'Error al actualizar estado de envío' });
  }
}

async function cotizarEnvioPublic(req, res) {
  try {
    const { ciudad, departamento, codigo_postal, peso, valor } = req.query;
    if (!ciudad || !departamento) {
      return res.status(400).json({ error: 'ciudad y departamento son obligatorios' });
    }

    const { cotizarEnvio: cotizar } = require('../services/shippingService');
    const resultado = await cotizar({
      ciudad,
      departamento,
      codigo_postal: codigo_postal || null,
      peso_total_kg: parseFloat(peso) || 0.5,
      valor_pedido: parseFloat(valor) || 0
    });

    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/store/shipping/quote:', error);
    res.status(500).json({ error: 'Error al cotizar envío' });
  }
}

module.exports = {
  ...exports,
  generarFacturaDianPedido,
  dispatchOrder,
  deliverOrder,
  cancelOrder,
  getAllStoreOrdersAdmin,
  getEnvioByGuia,
  updateEnvioStatus,
  cotizarEnvioPublic
};