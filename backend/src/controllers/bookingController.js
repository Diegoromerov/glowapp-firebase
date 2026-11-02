// backend/src/controllers/bookingController.js
const { pool } = require('../config/db');
const { runAsSystemContext } = require('../config/tenantRouting');
const { Booking, Service, User, Transaction } = require('../models');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const crypto = require('crypto');
const dianInvoiceClient = require('../services/dianInvoiceClient');

// ── Verificación de eventos de Wompi (integración real) ──────────────────────
// CORRECCIÓN DE CAUSA RAÍZ: el esquema anterior firmaba con HMAC-SHA256 el cuerpo
// y exigía los headers propios `x-wompi-signature` / `x-wompi-timestamp` /
// `x-wompi-nonce`. Ese esquema NO es el de Wompi: ningún evento real lo cumple,
// así que todos los webhooks legítimos habrían sido rechazados con 401 y ningún
// pago se habría confirmado nunca. El contrato real (docs.wompi.co → Eventos →
// Validación de integridad) es:
//
//   checksum = SHA256( <valores de signature.properties, en orden, sin separador>
//                      + <timestamp del evento>
//                      + <secreto de eventos> )        [hex minúscula]
//
// y llega en el header `X-Event-Checksum` o en `signature.checksum`. La lista
// `signature.properties` varía entre eventos: se lee del propio evento, nunca se
// asume fija. La verificación (y la comparación en tiempo constante) vive en
// wompiClient.verifyEventChecksum.
const wompiClient = require('../services/wompiClient');
const { discriminarIva } = require('../utils/iva');

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

const verifyWompiSignature = (req) => {
  // Sin secreto de eventos no hay nada que verificar: se falla en CERRADO.
  // El atajo que aceptaba cualquier evento en NODE_ENV=test contradecía el
  // contrato (401 a una firma no verificable) y hacía que la compuerta mintiera:
  // en CI, sin secreto, el webhook acusaba recibo (200) de eventos sin firma.
  const headerChecksum = req.header('x-event-checksum');
  const resultado = wompiClient.verifyEventChecksum(req.body, headerChecksum);

  if (!resultado.valid) {
    console.warn(`🚨 [FINTECH SECURITY ALERT] Evento Wompi rechazado desde IP ${req.ip}: ${resultado.reason}`);
  }

  return resultado.valid;
};

// 🔹 CREAR RESERVA
exports.createBooking = async (req, res) => {
  try {
    const clientId = req.user.id;
    let { provider_id, service_id, service_ids, scheduled_at, service_address, notes, productos_adicionales } = req.body;

    if (!service_ids && service_id) {
      service_ids = [service_id];
    }

    if (!provider_id || !service_ids || !Array.isArray(service_ids) || service_ids.length === 0 || !scheduled_at) {
      return res.status(400).json({ error: 'Faltan campos requeridos o formato inválido para service_ids' });
    }

    // Obtener y validar todos los servicios solicitados
    const services = await Service.findAll({
      where: {
        id: service_ids,
        provider_id
      }
    });

    if (services.length !== service_ids.length) {
      return res.status(404).json({ error: 'Uno o más servicios no fueron encontrados' });
    }

    // Condición tributaria del PRESTADOR, leída de SU cuenta — nunca del request:
    // un cliente no puede decidir la carga tributaria de la operación. Ver la
    // migración 086 para la base legal (art. 476 num. 1 lit. a y art. 437 par. 3
    // del Estatuto Tributario).
    const prestadorFiscal = await sequelize.query(
      'SELECT responsable_iva, tarifa_iva FROM usuarios WHERE id = :providerId;',
      { replacements: { providerId: provider_id }, type: sequelize.QueryTypes.SELECT }
    );
    const responsableIva =
      prestadorFiscal.length > 0 && prestadorFiscal[0].responsable_iva === true;
    const tarifaIvaAplicada = responsableIva
      ? Number(prestadorFiscal[0].tarifa_iva ?? 0.19)
      : 0;

    // Ordenar los servicios en base al orden recibido en service_ids
    const servicesMap = {};
    services.forEach(s => { servicesMap[s.id] = s; });
    const orderedServices = service_ids.map(id => servicesMap[id]);

    const totalServicesPrice = orderedServices.reduce((sum, s) => sum + parseFloat(s.price), 0);
    const totalDurationMinutes = orderedServices.reduce((sum, s) => sum + parseInt(s.duration_minutes), 0);

    let total_amount = totalServicesPrice;
    let cleanProductsList = [];

    // Validar y acumular productos adicionales
    if (productos_adicionales && Array.isArray(productos_adicionales) && productos_adicionales.length > 0) {
      for (const prodItem of productos_adicionales) {
        const { id, cantidad } = prodItem;
        const qty = parseInt(cantidad) || 1;

        const prodQuery = 'SELECT id, nombre, precio, stock FROM productos WHERE id = :productId;';
        const prodResults = await sequelize.query(prodQuery, {
          replacements: { productId: id },
          type: sequelize.QueryTypes.SELECT
        });

        if (prodResults.length === 0) {
          return res.status(404).json({ error: `Producto con ID ${id} no encontrado` });
        }

        const dbProd = prodResults[0];
        if (parseInt(dbProd.stock) < qty) {
          return res.status(400).json({ error: `Stock insuficiente para el producto: ${dbProd.nombre}` });
        }

        const prodPrice = parseFloat(dbProd.precio);
        total_amount += prodPrice * qty;

        cleanProductsList.push({
          id: dbProd.id,
          nombre: dbProd.nombre,
          precio: prodPrice,
          cantidad: qty
        });
      }
    }

    // 🔸 Validación de solapamiento de horarios (Collision Check de la duración acumulada)
    const newStart = new Date(scheduled_at);
    const newEnd = new Date(newStart.getTime() + totalDurationMinutes * 60 * 1000);
    
    // 🇨🇴 Filtrar citas del mismo día considerando la zona horaria de Colombia (America/Bogota UTC-5)
    const baseDate = new Date(scheduled_at);
    // 05:00 UTC corresponde a 00:00:00 hora Colombia del mismo día
    const startOfDay = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 5, 0, 0, 0));
    // 04:59:59 UTC del día siguiente corresponde a 23:59:59 hora Colombia
    const endOfDay = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + 1, 4, 59, 59, 999));

    const overlaps = await Booking.findAll({
      where: {
        provider_id,
        estado: { [Op.ne]: 'CANCELADA' },
        scheduled_at: {
          [Op.between]: [startOfDay, endOfDay]
        }
      },
      include: [{
        model: Service,
        as: 'service',
        attributes: ['duration_minutes']
      }]
    });

    // Verificar solapamiento en el subconjunto filtrado
    for (const b of overlaps) {
      const bStart = new Date(b.scheduled_at);
      const bDuration = parseInt(b.service.duration_minutes);
      const bEnd = new Date(bStart.getTime() + bDuration * 60 * 1000);

      if (newStart.getTime() < bEnd.getTime() && newEnd.getTime() > bStart.getTime()) {
        return res.status(409).json({ error: 'El horario seleccionado ya está reservado o entra en conflicto con otra cita' });
      }
    }

    // IVA — art. 476 num. 1 lit. a) E.T.: los tratamientos de belleza NO están
    // excluidos, así que están gravados a la tarifa general (19%, art. 468 E.T.).
    // Pero el precio que publica el prestador es el precio FINAL al consumidor,
    // así que el IVA se DISCRIMINA del total y NO se le suma: la reserva conserva
    // el precio que el cliente vio, y queda separada la base gravable que la
    // factura necesita. Si el prestador no es responsable de IVA (art. 437
    // par. 3 E.T.) la tarifa es 0 y el total entero es base.
    const { subtotalBase, ivaValor } = discriminarIva(total_amount, tarifaIvaAplicada);

    const pin = Math.floor(1000 + Math.random() * 9000).toString();

    // Costo transaccional de Wompi — tarifa confirmada por el comercio:
    // 2,65% + $700 + IVA, con el IVA SÓLO sobre la comisión (no sobre el monto),
    // que es como lo liquida Wompi.
    //
    // Dos cosas que esta cifra NO incluye, a propósito:
    //  - El recargo de 1,44% por tarjeta débito/crédito o PSE: el medio de pago
    //    se elige después, en el checkout, así que esto es la tarifa BASE.
    //  - OJO: `tarifa_reserva` no se lee en ningún flujo (ni el cobro, que usa
    //    `valor_bruto`, ni la liquidación del prestador). Es un dato guardado, así
    //    que corregirlo hoy no mueve dinero; si se va a usar, hay que mover el
    //    cálculo al momento del pago para poder aplicar el recargo del medio.
    const feeFijo = 700;
    const feeVariable = total_amount * 0.0265;
    const feeTotal = feeFijo + feeVariable;
    const ivaFee = feeTotal * 0.19;
    const tarifaReserva = Math.round(feeTotal + ivaFee);

    // Crear las múltiples citas secuenciales en la base de datos dentro de una transacción
    const generatedIds = orderedServices.map(() => crypto.randomUUID());
    let currentScheduledTime = new Date(scheduled_at);
    const createdBookings = [];

    await sequelize.transaction(async (t) => {
      for (let i = 0; i < orderedServices.length; i++) {
        const currentService = orderedServices[i];
        const currentId = generatedIds[i];
        const isPrimary = (i === 0);
        const durationMinutes = parseInt(currentService.duration_minutes);

        const bookingProducts = isPrimary ? (cleanProductsList.length > 0 ? cleanProductsList : []) : [];
        const bookingBruto = isPrimary ? total_amount : 0;
        const bookingTarife = isPrimary ? tarifaReserva : 0;

        const metadata = {
          products: bookingProducts,
          linked_booking_ids: generatedIds.filter(id => id !== currentId),
          is_primary: isPrimary,
          primary_booking_id: generatedIds[0]
        };

        const booking = await Booking.create({
          id: currentId,
          client_id: clientId,
          provider_id,
          service_id: currentService.id,
          scheduled_at: new Date(currentScheduledTime),
          valor_bruto: bookingBruto,
          tarifa_reserva: bookingTarife,
          subtotal_base: isPrimary ? subtotalBase : null,
          iva_valor: isPrimary ? ivaValor : null,
          tarifa_iva_aplicada: isPrimary ? tarifaIvaAplicada : null,
          service_address: service_address || null,
          notes: notes || null,
          estado: 'PENDIENTE_PAGO',
          pin_verificacion: pin,
          productos_adicionales: metadata
        }, { transaction: t });

        createdBookings.push(booking);

        // Incrementar el tiempo de inicio para la siguiente cita
        currentScheduledTime = new Date(currentScheduledTime.getTime() + durationMinutes * 60 * 1000);
      }
    });

    const primaryBooking = createdBookings[0];
    console.log(`📅 Nuevas citas enlazadas creadas: [${generatedIds.join(', ')}] para usuario ${clientId} con PIN ${pin}.`);

    // Enviar SMS simulado y notificar vía WebSocket con alerta auditiva "GlowApp"
    try {
      const { rows: providerRows } = await pool.query('SELECT nombre, phone FROM usuarios WHERE id = $1', [provider_id]);
      if (providerRows.length > 0) {
        const provider = providerRows[0];
        const providerPhone = provider.phone || 'no-phone';
        const msgText = `¡Tienes una nueva reserva en GlowApp! Alerta auditiva: GlowApp`;
        
        console.log(`[SMS SENDER] Enviando SMS a ${providerPhone} (${provider.nombre}): "${msgText}"`);
        
        const { notifyProviderNewBooking } = require('../services/websocketService');
        notifyProviderNewBooking(provider_id, msgText);
      }
    } catch (notifyErr) {
      console.error('⚠️ Error al notificar al prestador de nueva cita:', notifyErr.message);
    }

    res.json({
      success: true,
      message: 'Citas reservadas exitosamente',
      booking_id: primaryBooking.id,
      pin_verificacion: pin,
      booking: primaryBooking,
      bookings: createdBookings
    });
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error al crear la reserva' });
  }
};

// 🔹 Panel de Prestador: Obtener citas
exports.getProviderBookings = async (req, res) => {
  try {
    const allowedRoles = ['provider', 'PRESTADOR', 'salon', 'SALON'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso denegado: solo para proveedores o salones' });
    }

    // Usamos pool para queries directas si son a tablas no mapeadas (o complejas), 
    // pero Sequelize es genial para obtener la estructura limpia.
    const query = `
      SELECT 
        b.id, b.scheduled_at, b.estado AS status, b.valor_bruto AS total_amount, 
        b.comision_plataforma AS platform_commission, b.impuestos_estado AS state_tax, b.pago_neto_prestador AS provider_net_amount,
        b.client_id, b.pin_verificacion, b.service_address,
        s.name as service_name, s.price,
        u.nombre as client_name, u.phone as client_phone,
        t.external_id AS wompi_reference, t.status AS payout_status
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN usuarios u ON b.client_id = u.id
      LEFT JOIN transactions t ON b.id = t.booking_id
      WHERE b.provider_id = $1
      ORDER BY b.scheduled_at ASC;
    `;
    
    const result = await pool.query(query, [req.user.id]);
    
    const formattedBookings = result.rows.map(row => ({
      id: row.id,
      client_id: row.client_id ? row.client_id.toString() : '5',
      scheduled_at: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      status: row.status,
      total_amount: parseFloat(row.total_amount) || 0,
      platform_commission: parseFloat(row.platform_commission) || 0,
      state_tax: parseFloat(row.state_tax) || 0,
      provider_net_amount: parseFloat(row.provider_net_amount) || 0,
      service_name: row.service_name,
      price: parseFloat(row.price) || 0,
      client_name: row.client_name,
      client_phone: row.client_phone,
      service_address: row.service_address || '',
      pin_verificacion: row.pin_verificacion || null,
      wompi_reference: row.wompi_reference || null,
      payout_status: row.payout_status || null
    }));
    
    res.json({ success: true, count: formattedBookings.length, data: formattedBookings });
    
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings/provider:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error interno al cargar citas' });
  }
};

// 🔹 Actualizar estado de cita
exports.updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const bookingId = req.params.id;
    const providerId = req.user.id;

    const mapStatusToDb = (status) => {
      const s = status.toUpperCase();
      if (s === 'PENDING' || s === 'PENDIENTE_PAGO') return 'PENDIENTE_PAGO';
      if (s === 'CONFIRMED' || s === 'CONFIRMADA') return 'CONFIRMADA';
      if (s === 'COMPLETED' || s === 'COMPLETADA') return 'COMPLETADA';
      if (s === 'CANCELLED' || s === 'CANCELADA') return 'CANCELADA';
      return s;
    };

    const dbStatus = mapStatusToDb(status);

    const validStatuses = ['PENDIENTE_PAGO', 'CONFIRMADA', 'EN_PROGRESO', 'FINALIZADA_PRESTADOR', 'COMPLETADA', 'CANCELADA'];
    if (!validStatuses.includes(dbStatus)) {
      return res.status(400).json({ error: `Estado inválido. Permitidos: ${validStatuses.join(', ')}` });
    }

    const booking = await Booking.findOne({
      where: { id: bookingId, provider_id: providerId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }

    booking.estado = dbStatus;
    await booking.save();

    console.log('✅ Cita actualizada a estado:', dbStatus);
    
    res.json({ 
      success: true, 
      booking: {
        id: booking.id,
        status: booking.estado
      } 
    });
    
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/bookings/:id/status:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
};

// 🔹 Historial de Citas del Cliente
exports.getClientBookings = async (req, res) => {
  try {
    const clientId = req.user.id;

    const query = `
      SELECT 
        b.id, b.scheduled_at, b.estado AS status, b.valor_bruto AS total_amount, b.service_address, b.notes, b.pin_verificacion,
        s.name as service_name, s.duration_minutes as service_duration,
        u_prov.nombre as provider_name,
        p.business_name as provider_business_name,
        u_prov.foto_url as provider_avatar_url,
        u_prov.phone as provider_phone,
        r.id as review_id, r.rating as review_rating, r.comment as review_comment
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN perfiles_prestador p ON b.provider_id = p.id
      JOIN usuarios u_prov ON p.id = u_prov.id
      LEFT JOIN reviews r ON b.id = r.booking_id
      WHERE b.client_id = $1
      ORDER BY b.scheduled_at DESC;
    `;
    
    const result = await pool.query(query, [clientId]);
    
    const formattedBookings = result.rows.map(row => ({
      id: row.id,
      scheduled_at: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      status: row.status,
      total_amount: parseFloat(row.total_amount) || 0,
      service_address: row.service_address || '',
      notes: row.notes || '',
      pin_verificacion: row.pin_verificacion || null,
      service_name: row.service_name,
      service_duration: parseInt(row.service_duration) || 0,
      provider_name: row.provider_name,
      provider_business_name: row.provider_business_name || '',
      provider_avatar_url: row.provider_avatar_url || '',
      provider_phone: row.provider_phone || '',
      is_reviewed: row.review_id !== null,
      review: row.review_id ? {
        id: row.review_id,
        rating: parseInt(row.review_rating) || 0,
        comment: row.review_comment || ''
      } : null
    }));
    
    res.json({ success: true, count: formattedBookings.length, data: formattedBookings });
    
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings/client:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error interno al cargar el historial de citas' });
  }
};

// 🔹 Cancelar cita por cliente
exports.cancelBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;

    const booking = await Booking.findOne({
      where: { id: bookingId, client_id: clientId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para cancelarla' });
    }

    if (booking.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'La cita ya está cancelada' });
    }
    if (booking.estado === 'COMPLETADA') {
      return res.status(400).json({ error: 'No se puede cancelar una cita que ya ha sido completada' });
    }

    // ── D-GL-023 · Política de cancelación por tramos ──────────────────────
    // >24 h antes: se devuelve el 100%. Entre 2 y 24 h: se devuelve el 50% y el
    // prestador conserva el 80% de lo cobrado. Con menos de 2 h o no-show: se
    // cobra el 100%. Antes no existía ninguna de estas reglas: se cancelaba y no
    // pasaba nada con el dinero.
    const horasAntes = (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000);
    let tramo = 'MENOS_2H';
    let porcentajeDevolucion = 0;

    if (horasAntes >= 24) {
      tramo = 'MAS_24H';
      porcentajeDevolucion = 100;
    } else if (horasAntes >= 2) {
      tramo = 'ENTRE_2_Y_24H';
      porcentajeDevolucion = 50;
    }

    const estabaPagada = booking.payment_status === 'paid';
    const brutoReserva = Number(booking.valor_bruto) || 0;
    const montoDevolucion = Math.round((brutoReserva * porcentajeDevolucion) / 100);
    const montoCobrado = brutoReserva - montoDevolucion;

    // P0 DINERO #2 — reversión de stock al cancelar.
    // payBooking() y el webhook de Wompi descuentan el stock de los productos adicionales
    // cuando la cita pasa a pagada. Si la cita se cancela y ese stock no se devuelve, las
    // unidades quedan 'fantasma': descontadas de un pedido que ya no existe (inventario
    // real > stock en base) mientras el pago sí se reversa. Sólo se revierte lo que se
    // descontó: citas que nunca se pagaron (payment_status != 'paid') no tocaron stock.
    // Todo dentro de la MISMA transacción que el cambio de estado: o se cancela y se
    // devuelve el stock, o no ocurre ninguna de las dos cosas.
    await sequelize.transaction(async (t) => {
      const wasPaid = booking.payment_status === 'paid';

      const productsList = Array.isArray(booking.productos_adicionales)
        ? booking.productos_adicionales
        : (booking.productos_adicionales && Array.isArray(booking.productos_adicionales.products)
            ? booking.productos_adicionales.products
            : []);

      if (wasPaid && productsList.length > 0) {
        for (const item of productsList) {
          const qty = parseInt(item.cantidad) || 0;
          if (qty <= 0) continue;

          const prodRes = await sequelize.query(
            'SELECT stock, nombre FROM productos WHERE id = :productId FOR UPDATE;',
            {
              replacements: { productId: item.id },
              type: sequelize.QueryTypes.SELECT,
              transaction: t
            }
          );

          if (prodRes.length === 0) {
            // El producto ya no existe: no se puede devolver su stock, pero eso no debe
            // impedir la cancelación de la cita.
            console.warn(`⚠️ [CANCEL] Producto ${item.id} no encontrado al revertir stock de la cita ${bookingId}`);
            continue;
          }

          await sequelize.query(
            'UPDATE productos SET stock = stock + :qty WHERE id = :productId;',
            {
              replacements: { qty, productId: item.id },
              type: sequelize.QueryTypes.UPDATE,
              transaction: t
            }
          );
        }
      }

      booking.estado = 'CANCELADA';
      booking.cancelado_por = 'CLIENTE';
      booking.cancelado_at = new Date();
      await booking.save({ transaction: t });

      // ── D-GL-023 · Asientos de la cancelación ────────────────────────────
      if (estabaPagada) {
        await sequelize.query(
          `INSERT INTO reembolsos
             (booking_id, client_id, monto, porcentaje_devolucion, tramo, motivo, estado)
           VALUES (:bookingId, :clientId, :monto, :pct, :tramo, :motivo, 'PENDIENTE');`,
          {
            replacements: {
              bookingId,
              clientId,
              monto: montoDevolucion,
              pct: porcentajeDevolucion,
              tramo,
              motivo: `Cancelación del cliente con ${Math.max(0, horasAntes).toFixed(1)} h de anticipación`
            },
            type: sequelize.QueryTypes.INSERT,
            transaction: t
          }
        );

        // El prestador conserva el 80% de la parte cobrada, si la hay.
        const netoPrestador = Math.round(montoCobrado * 0.8);
        if (netoPrestador > 0) {
          await sequelize.query(
            `INSERT INTO provider_wallet (provider_id, saldo_disponible, total_ganado)
             VALUES (:providerId, :neto, :neto)
             ON CONFLICT (provider_id) DO UPDATE
               SET saldo_disponible = provider_wallet.saldo_disponible + :neto,
                   total_ganado      = provider_wallet.total_ganado + :neto,
                   updated_at        = NOW();`,
            {
              replacements: { providerId: booking.provider_id, neto: netoPrestador },
              type: sequelize.QueryTypes.INSERT,
              transaction: t
            }
          );

          await sequelize.query(
            `INSERT INTO wallet_transactions
               (provider_id, booking_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
             SELECT :providerId, :bookingId, 'CREDITO_SERVICIO', :neto,
                    saldo_disponible + saldo_pendiente, 'COMPLETADO',
                    :desc, CAST(:meta AS jsonb)
             FROM provider_wallet WHERE provider_id = :providerId;`,
            {
              replacements: {
                providerId: booking.provider_id,
                bookingId,
                neto: netoPrestador,
                desc: 'Compensación por cancelación tardía del cliente',
                meta: JSON.stringify({ tramo, porcentaje_devolucion: porcentajeDevolucion, monto_cobrado: montoCobrado })
              },
              type: sequelize.QueryTypes.INSERT,
              transaction: t
            }
          );
        }
      }
    });

    console.log(`❌ Cita ${bookingId} cancelada por el cliente ${clientId}`);

    res.json({
      success: true,
      message: tramo === 'MAS_24H'
        ? 'Cita cancelada. Se devuelve el 100% de lo pagado.'
        : tramo === 'ENTRE_2_Y_24H'
          ? 'Cita cancelada. Se devuelve el 50% de lo pagado.'
          : 'Cita cancelada dentro de las 2 horas previas: no aplica devolución.',
      booking: {
        id: booking.id,
        status: booking.estado
      },
      cancelacion: {
        tramo,
        horas_anticipacion: Math.max(0, Number(horasAntes.toFixed(1))),
        porcentaje_devolucion: porcentajeDevolucion,
        monto_devolucion: estabaPagada ? montoDevolucion : 0,
        monto_cobrado: estabaPagada ? montoCobrado : 0
      }
    });

  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/bookings/:id/cancel:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error interno al cancelar la cita' });
  }
};

// 🔹 Reprogramar cita (Cliente) — una sola vez y hasta 24 h antes
// D-GL-023: la primera reprogramación es gratis; la segunda cuenta como
// cancelación y el botón debe quedar bloqueado. El bloqueo vive aquí (API),
// no solo en la interfaz.
exports.rescheduleBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;
    const { scheduled_at } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({ error: 'Debes indicar la nueva fecha y hora.' });
    }

    const booking = await Booking.findOne({ where: { id: bookingId, client_id: clientId } });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o sin permisos para reprogramarla.' });
    }

    if (!['PENDIENTE_PAGO', 'CONFIRMADA'].includes(booking.estado)) {
      return res.status(409).json({
        error: `No se puede reprogramar una cita en estado ${booking.estado}.`,
        accion: 'CANCELAR'
      });
    }

    const veces = Number(booking.reschedule_count) || 0;
    if (veces >= 1) {
      return res.status(409).json({
        error: 'Ya usaste tu reprogramación gratuita. Una segunda reprogramación cuenta como cancelación.',
        accion: 'CANCELAR',
        reprogramaciones_usadas: veces
      });
    }

    const horasAntes = (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000);
    if (horasAntes < 24) {
      return res.status(409).json({
        error: 'La reprogramación gratuita se cierra 24 horas antes del servicio.',
        accion: 'CANCELAR',
        horas_anticipacion: Number(Math.max(0, horasAntes).toFixed(1))
      });
    }

    const nuevaFecha = new Date(scheduled_at);
    if (isNaN(nuevaFecha.getTime()) || nuevaFecha.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'La nueva fecha debe ser futura.' });
    }

    booking.scheduled_at = nuevaFecha;
    booking.reschedule_count = veces + 1;
    await booking.save();

    res.json({
      success: true,
      message: 'Cita reprogramada. Esta fue tu reprogramación gratuita.',
      booking: {
        id: booking.id,
        scheduled_at: booking.scheduled_at,
        reschedule_count: booking.reschedule_count
      },
      puede_reprogramar: false
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/bookings/:id/reschedule:', error.message);
    res.status(500).json({ error: 'Error interno al reprogramar la cita' });
  }
};

// 🔹 Cancelar cita por el prestador
// D-GL-023: >24 h no hay sanción; <24 h cuenta en el score y tres en 90 días
// suspenden los retiros. Antes el prestador simplemente no tenía forma de cancelar.
exports.cancelBookingByProvider = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const providerId = req.user.id;

    const booking = await Booking.findOne({ where: { id: bookingId, provider_id: providerId } });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o sin permisos para cancelarla.' });
    }
    if (booking.estado === 'CANCELADA') {
      return res.status(400).json({ error: 'La cita ya está cancelada' });
    }
    if (booking.estado === 'COMPLETADA') {
      return res.status(400).json({ error: 'No se puede cancelar una cita completada' });
    }

    const horasAntes = (new Date(booking.scheduled_at).getTime() - Date.now()) / (60 * 60 * 1000);
    const tardia = horasAntes < 24;

    booking.estado = 'CANCELADA';
    booking.cancelado_por = 'PRESTADOR';
    booking.cancelado_at = new Date();
    await booking.save();

    // Devolución íntegra al cliente: la falta es del prestador.
    if (booking.payment_status === 'paid') {
      await sequelize.query(
        `INSERT INTO reembolsos
           (booking_id, client_id, monto, porcentaje_devolucion, tramo, motivo, estado)
         VALUES (:bookingId, :clientId, :monto, 100, 'CANCELA_PRESTADOR', :motivo, 'PENDIENTE');`,
        {
          replacements: {
            bookingId,
            clientId: booking.client_id,
            monto: Number(booking.valor_bruto) || 0,
            motivo: `Cancelación del prestador con ${Math.max(0, horasAntes).toFixed(1)} h de anticipación`
          },
          type: sequelize.QueryTypes.INSERT
        }
      );
    }

    let suspendido = false;
    let cancelaciones90d = 0;

    if (tardia) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total
           FROM bookings
          WHERE provider_id = $1
            AND cancelado_por = 'PRESTADOR'
            AND cancelado_at > NOW() - INTERVAL '90 days'`,
        [providerId]
      );
      cancelaciones90d = rows[0]?.total || 0;

      await pool.query(
        `UPDATE perfiles_prestador
            SET cancelaciones_tardias = cancelaciones_tardias + 1
          WHERE id = $1`,
        [providerId]
      );

      if (cancelaciones90d >= 3) {
        suspendido = true;
        await pool.query(
          `INSERT INTO provider_wallet (provider_id, retiros_pausados)
           VALUES ($1, TRUE)
           ON CONFLICT (provider_id) DO UPDATE SET retiros_pausados = TRUE, updated_at = NOW()`,
          [providerId]
        );
      }
    }

    res.json({
      success: true,
      message: tardia
        ? 'Cita cancelada. Por cancelar con menos de 24 h se registró en tu historial.'
        : 'Cita cancelada sin sanción.',
      booking: { id: booking.id, status: booking.estado },
      cancelacion: {
        horas_anticipacion: Number(Math.max(0, horasAntes).toFixed(1)),
        tardia,
        cancelaciones_90d: cancelaciones90d,
        retiros_suspendidos: suspendido,
        devolucion_cliente: booking.payment_status === 'paid' ? Number(booking.valor_bruto) || 0 : 0
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/bookings/:id/cancel-provider:', error.message);
    res.status(500).json({ error: 'Error interno al cancelar la cita' });
  }
};

// 🔹 Cobro real con Wompi para una cita (Cliente)
//
// Qué hace: crea una TRANSACCIÓN en la API de Wompi con la firma de integridad
// calculada en el servidor y deja la cita como estaba (PENDIENTE_PAGO) hasta que
// el webhook `transaction.updated` confirme el pago. Este endpoint NUNCA marca
// `payment_status='paid'`: lo que no cobró Wompi no se marca como cobrado.
//
// Cuerpo esperado:
//   { acceptance_token, payment_method: 'NEQUI'|'CARD',
//     payment_source_id?                              ← fuente guardada (Nequi: vía /tokens/nequi + /payment_sources)
//     phone_number?     (NEQUI)
//     payment_method_token? (+ installments para CARD) }
//
// La tokenización del medio de pago (tarjeta/Nequi) ocurre en el cliente contra
// Wompi; aquí solo llega el token o el id de la fuente de pago, nunca el PAN/CVV.
exports.payBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;

    // Compuerta explícita: sin credenciales reales no se intenta cobrar ni se
    // simula en su lugar.
    if (!wompiClient.isConfigured()) {
      return res.status(503).json({
        error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        message: 'La pasarela de pagos no está configurada (faltan credenciales de Wompi). No se realizó ningún cobro.'
      });
    }

    const { payment_method, payment_source_id, payment_method_token, installments, acceptance_token, phone_number, redirect_url, customer_data } = req.body;

    const method = (payment_method || '').toUpperCase();
    const validPaymentMethods = [
      'NEQUI', 'CARD', 'PSE', 'BANCOLOMBIA_TRANSFER', 'DAVIPLATA',
      'BANCO_DE_BOGOTA_TRANSFER', 'BANCO_DE_OCCIDENTE_TRANSFER',
      'BANCO_AV_VILLAS_TRANSFER', 'BANCO_POPULAR_TRANSFER', 'BANCO_PICHINCHA_TRANSFER'
    ];
    if (!validPaymentMethods.includes(method)) {
      return res.status(400).json({ error: `Método de pago inválido. Permitidos: ${validPaymentMethods.join(', ')}` });
    }

    if (!acceptance_token) {
      return res.status(400).json({
        error: 'MISSING_ACCEPTANCE_TOKEN',
        message: 'acceptance_token es obligatorio: el usuario debe aceptar los términos de Wompi antes de pagar.'
      });
    }

    // Instrumento de pago según método
    const redirectMethods = [
      'PSE', 'BANCOLOMBIA_TRANSFER', 'DAVIPLATA',
      'BANCO_DE_BOGOTA_TRANSFER', 'BANCO_DE_OCCIDENTE_TRANSFER',
      'BANCO_AV_VILLAS_TRANSFER', 'BANCO_POPULAR_TRANSFER', 'BANCO_PICHINCHA_TRANSFER'
    ];

    if (!payment_source_id) {
      if (method === 'CARD' && !payment_method_token) {
        return res.status(400).json({
          error: 'MISSING_PAYMENT_INSTRUMENT',
          message: 'Para tarjeta se requiere payment_source_id o payment_method_token (token de POST /tokens/cards).'
        });
      }
      if (method === 'NEQUI' && !phone_number) {
        return res.status(400).json({
          error: 'MISSING_PAYMENT_INSTRUMENT',
          message: 'Para Nequi se requiere payment_source_id o phone_number. Wompi no acepta un `token` en payment_method NEQUI: tokeniza en POST /tokens/nequi y crea una fuente de pago (POST /payment_sources).'
        });
      }
      if (redirectMethods.includes(method)) {
        // `.trim().isEmpty` es Dart, no JS: una URL de solo espacios pasaba.
        if (!esUrlHttpValida(redirect_url)) {
          return res.status(400).json({ error: 'redirect_url debe ser una URL http(s) válida para pagos con redirección (PSE, Bancolombia, Daviplata).' });
        }
        if (!customer_data || !customer_data.email || !customer_data.full_name || !customer_data.phone_number) {
          return res.status(400).json({ error: 'customer_data (email, full_name, phone_number) es obligatorio para pagos con redirección.' });
        }
      }
    }

    const booking = await Booking.findOne({ where: { id: bookingId, client_id: clientId } });
    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para pagarla' });
    }
    if (booking.estado !== 'PENDIENTE_PAGO') {
      return res.status(400).json({ error: `La cita no se encuentra en estado PENDIENTE_PAGO. Estado actual: ${booking.estado}` });
    }

    const amount = Math.round(parseFloat(booking.valor_bruto));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({ error: 'La reserva no tiene un monto cobrable.' });
    }
    const amountInCents = amount * 100;

    // Wompi exige `reference` único por transacción. La primera intentona usa el
    // id de la cita; los reintentos (p.ej. tras un DECLINED) agregan sufijo.
    const intentosPrevios = await Transaction.count({ where: { booking_id: bookingId } });
    const reference = intentosPrevios === 0 ? bookingId : `${bookingId}-r${intentosPrevios + 1}`;

    // Preparar datos para Wompi según el método
    // - NEQUI con phone_number: paymentMethod = { type: 'NEQUI', phone_number }
    // - NEQUI con payment_source_id: paymentSourceId = payment_source_id
    // - CARD con payment_source_id: paymentSourceId = payment_source_id
    // - CARD con payment_method_token: paymentMethod = { type: 'CARD', token, installments }
    // - PSE / transferencias: paymentMethod = method (string), customerData, redirectUrl
    let paymentSourceId = null;
    let paymentMethod = null;

    if (method === 'NEQUI') {
      if (phone_number) {
        paymentMethod = { type: 'NEQUI', phone_number };
      } else if (payment_source_id) {
        paymentSourceId = payment_source_id;
      }
    } else if (method === 'CARD') {
      if (payment_source_id) {
        paymentSourceId = payment_source_id;
      } else if (payment_method_token) {
        paymentMethod = {
          type: 'CARD',
          token: payment_method_token,
          installments: installments || 1
        };
      }
    } else if (redirectMethods.includes(method)) {
      // PSE, Daviplata, etc. - paymentMethod será el string del método
      paymentMethod = method;
    }

    const wompiTransactionData = {
      amountInCents,
      currency: 'COP',
      reference,
      customerEmail: req.user.email,
      acceptanceToken: acceptance_token,
      paymentSourceId,
      customerData: redirectMethods.includes(method) ? customer_data : null,
      redirectUrl: redirectMethods.includes(method) ? redirect_url : null,
      ip: req.ip
    };

    // paymentMethod solo si NO hay paymentSourceId (exclusividad Wompi)
    if (paymentMethod) {
      wompiTransactionData.paymentMethod = paymentMethod;
    }

    // Para métodos de redirección, Wompi espera payment_method con el tipo específico
    if (redirectMethods.includes(method)) {
      wompiTransactionData.paymentMethod = method;
      wompiTransactionData.paymentSourceId = null;
    }

    let wompiTx;
    try {
      wompiTx = await wompiClient.createTransaction(wompiTransactionData);
    } catch (err) {
      const detalle = err?.body?.error?.messages || err?.message || 'error desconocido';
      console.error(`❌ [WOMPI] No se pudo crear la transacción para la cita ${bookingId}:`, JSON.stringify(detalle));
      // Error de red (ECONNRESET, ETIMEDOUT, ENOTFOUND) → 502
      // Error 4xx de Wompi → 402
      const isNetworkError = err?.cause?.code === 'ECONNRESET' || 
                            err?.cause?.code === 'ETIMEDOUT' || 
                            err?.cause?.code === 'ENOTFOUND' ||
                            err?.code === 'ECONNRESET' ||
                            err?.code === 'ETIMEDOUT' ||
                            err?.code === 'ENOTFOUND';
      const status = isNetworkError ? 502 : 
                    (err?.status && err.status >= 400 && err.status < 500 ? 402 : 502);
      return res.status(status).json({
        error: 'WOMPI_TRANSACTION_FAILED',
        message: 'Wompi rechazó la creación de la transacción. No se realizó ningún cobro.',
        detalle
      });
    }

    // Registrar la transacción local como PENDIENTE (la confirmación es del webhook).
    // En reintentos la fila ya existe: hay que reapuntarla a la transacción VIVA, o
    // `external_id` queda apuntando a un intento muerto y el webhook no la reconoce.
    const [txLocal, creada] = await Transaction.findOrCreate({
      where: { booking_id: bookingId },
      defaults: {
        amount: booking.valor_bruto,
        status: 'pending',
        payment_method: method,
        external_id: wompiTx.id
      }
    });

    if (!creada && txLocal.external_id !== wompiTx.id) {
      await txLocal.update({
        amount: booking.valor_bruto,
        status: 'pending',
        payment_method: method,
        external_id: wompiTx.id
      });
    }

    console.log(`💳 [WOMPI] Transacción ${wompiTx.id} (${wompiTx.status}) creada para la cita ${bookingId}. Pendiente de confirmación por webhook.`);

    return res.status(202).json({
      success: true,
      message: redirectMethods.includes(method)
        ? 'Transacción creada en Wompi. El pago se completa cuando el usuario autorice en la URL de redirección.'
        : 'Transacción creada en Wompi. El pago se confirma cuando Wompi notifica el evento.',
      status: wompiTx.status,
      wompi_transaction_id: wompiTx.id,
      reference: wompiTx.reference,
      amount,
      payment_method: method,
      // Sólo para PSE / Bancolombia / Daviplata: el cliente DEBE abrir esta URL para
      // autorizar. Sin ella la transacción queda PENDING y no hay forma de pagarla.
      async_payment_url: wompiTx.asyncPaymentUrl || null
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/bookings/:id/pay:', error);
    res.status(500).json({ error: 'Error interno al procesar el pago' });
  }
};

// 🔹 Webhook de Wompi (pago de cita) — confirma con el evento real de Wompi
const procesarWebhookWompi = async (req, res) => {
  try {
    if (!verifyWompiSignature(req)) {
      return res.status(401).json({ error: 'Firma de webhook inválida.' });
    }

    const { event, data } = req.body;
    console.log('📡 [WOMPI WEBHOOK RECEIVED] Evento:', event);

    if (event === 'transaction.updated' && data && data.transaction) {
      const tx = data.transaction;
      const status = tx.status;
      const amount = tx.amount_in_cents / 100;
      const paymentMethod = tx.payment_method_type || 'NEQUI';
      const externalId = tx.id;

      // `reference` es la referencia con la que creamos la transacción: el id de
      // la cita en el primer intento, o `<bookingId>-rN` en los reintentos.
      const reference = String(tx.reference || '');
      const bookingId = reference.replace(/-r\d+$/, '');

      if (status === 'APPROVED') {
        await sequelize.transaction(async (t) => {
          // 🛡️ 1. Idempotencia: Verificar si ya existe una transacción pagada para esta cita o external_id
          const existingTx = await Transaction.findOne({
            where: {
              [Op.or]: [
                { external_id: externalId },
                { booking_id: bookingId, status: 'paid' }
              ]
            },
            transaction: t
          });

          if (existingTx && existingTx.status === 'paid') {
            console.log(`ℹ️ [WOMPI WEBHOOK] Evento duplicado ignorado para cita ${bookingId} / tx ${externalId}`);
            return;
          }

          // 🛡️ 2. Validar que la reserva existe y que el monto pagado cubre el valor_bruto (C5)
          const booking = await Booking.findByPk(bookingId, { transaction: t });
          if (!booking) {
            throw new Error(`Reserva no encontrada para ID ${bookingId}`);
          }

          const expectedAmount = parseFloat(booking.valor_bruto) || 0;
          if (amount < expectedAmount) {
            console.error(`🚨 [FINTECH SECURITY ALERT] Fraude de monto en webhook: Pagado ${amount} COP, Requerido ${expectedAmount} COP para cita ${bookingId}`);
            throw new Error(`El monto pagado (${amount}) es menor al valor bruto esperado de la reserva (${expectedAmount}).`);
          }

          // Actualizar cita a CONFIRMADA
          await Booking.update(
            { estado: 'CONFIRMADA', payment_status: 'paid' },
            { where: { id: bookingId }, transaction: t }
          );

          // Obtener la cita y propagar a citas hijas vinculadas si existen
          if (booking.productos_adicionales && Array.isArray(booking.productos_adicionales.linked_booking_ids)) {
            const linkedIds = booking.productos_adicionales.linked_booking_ids;
            if (linkedIds.length > 0) {
              await Booking.update(
                { estado: 'CONFIRMADA', payment_status: 'paid' },
                { where: { id: linkedIds }, transaction: t }
              );
            }
          }

          // Decrementar stock de productos con validación preventiva (FOR UPDATE)
          const productsList = booking.productos_adicionales
            ? (Array.isArray(booking.productos_adicionales)
                ? booking.productos_adicionales
                : (Array.isArray(booking.productos_adicionales.products)
                    ? booking.productos_adicionales.products
                    : []))
            : [];

          if (productsList.length > 0) {
            for (const item of productsList) {
              const prodRes = await sequelize.query(
                'SELECT stock, nombre FROM productos WHERE id = :productId FOR UPDATE;',
                {
                  replacements: { productId: item.id },
                  type: sequelize.QueryTypes.SELECT,
                  transaction: t
                }
              );
              if (prodRes.length === 0) {
                throw new Error(`Producto con ID ${item.id} no encontrado.`);
              }
              const currentStock = parseInt(prodRes[0].stock) || 0;
              if (currentStock < item.cantidad) {
                throw new Error(`Stock insuficiente para el producto: ${prodRes[0].nombre}. Disponible: ${currentStock}, Solicitado: ${item.cantidad}`);
              }
              await sequelize.query(
                'UPDATE productos SET stock = stock - :qty WHERE id = :productId;',
                {
                  replacements: { qty: item.cantidad, productId: item.id },
                  type: sequelize.QueryTypes.UPDATE,
                  transaction: t
                }
              );
            }
          }

          // Registrar la transacción
          const [trans, created] = await Transaction.findOrCreate({
            where: { booking_id: bookingId },
            defaults: {
              amount: amount,
              status: 'paid',
              payment_method: paymentMethod,
              external_id: externalId
            },
            transaction: t
          });

          if (!created) {
            trans.status = 'paid';
            trans.external_id = externalId;
            await trans.save({ transaction: t });
          }

          // 🔹 Generar factura electrónica DIAN (async, no bloquea confirmación)
          try {
            await generarFacturaDian(bookingId, t);
          } catch (invoiceError) {
            console.error(`❌ [DIAN INVOICE] Error generando factura para cita ${bookingId}:`, invoiceError.message);
            // No falla el webhook: la factura se puede reintentar manualmente
          }
        });

        console.log(`✅ [WOMPI WEBHOOK SUCCESS] Cita ${bookingId} confirmada por webhook Sequelize.`);
      } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(status)) {
        // Estados finales de rechazo: la transacción local no puede quedarse
        // pendiente para siempre ni, mucho menos, figurar como pagada.
        await Transaction.update(
          { status: 'failed', external_id: externalId },
          { where: { booking_id: bookingId } }
        );
        console.log(`⚠️ [WOMPI WEBHOOK] Transacción ${externalId} de la cita ${bookingId} quedó en ${status}.`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ ERROR EN /api/payments/wompi-webhook:', error);
    res.status(500).json({ error: 'Error al procesar el webhook' });
  }
};

/**
 * Webhook de Wompi: procesa con el ROL DE SISTEMA activo.
 *
 * No nace de una petición autenticada, así que NO tiene inquilino, y por diseño
 * es cross-tenant: confirma la cita de CUALQUIER salón a partir de una referencia
 * firmada. Con FORCE ROW LEVEL SECURITY (migración 068) sus consultas de Sequelize
 * irían sin contexto y devolverían 0 filas, de modo que `Booking.findByPk`
 * respondería "Reserva no encontrada" y el pago nunca se confirmaría. El
 * envoltorio activa app_system (BYPASSRLS) durante el procesamiento.
 *
 * El contrato de la API no cambia: misma ruta, misma respuesta, mismos códigos.
 */
exports.wompiWebhook = (req, res) => {
  // Wompi entrega TODOS los eventos a UNA sola URL, la que se configura en el
  // dashboard del comercio. Hay dos clases de transacciones: reservas (referencia
  // = <bookingId> o <bookingId>-rN) y pedidos de tienda (referencia
  // `wompi_order_<id>_<ts>`, ver orderController.payOrder). Sin este despacho el
  // evento de un pedido entraba al flujo de reservas, no encontraba la reserva y
  // Wompi reintentaba para siempre: el pedido no se cerraba nunca.
  // El `require` es perezoso para no crear un ciclo de imports entre controllers.
  const referencia = String(
    req.body?.data?.transaction?.reference
      ?? req.body?.data?.reference
      ?? ''
  );
  if (referencia.startsWith('wompi_order_')) {
    return require('./orderController').storeWebhook(req, res);
  }
  return runAsSystemContext(() => procesarWebhookWompi(req, res));
};

// Expuesto para pruebas unitarias del contrato de verificación de eventos.
exports.verifyWompiSignature = verifyWompiSignature;

// 🔹 Crear reseña para cita completada
exports.createReview = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;
    const { rating, comment } = req.body;

    const parsedRating = parseInt(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'La calificación debe ser un número entero entre 1 y 5' });
    }

    const booking = await Booking.findOne({
      where: { id: bookingId, client_id: clientId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para calificarla' });
    }

    if (booking.estado !== 'COMPLETADA') {
      return res.status(400).json({ error: 'Solo puedes calificar citas que hayan sido completadas' });
    }

    const reviewCheck = await pool.query('SELECT id FROM reviews WHERE booking_id = $1', [bookingId]);
    if (reviewCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Esta cita ya ha sido calificada' });
    }

    const clientDb = await pool.connect();
    try {
      await clientDb.query('BEGIN');

      const insertReviewQuery = `
        INSERT INTO reviews (booking_id, client_id, provider_id, rating, comment)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id;
      `;
      await clientDb.query(insertReviewQuery, [bookingId, clientId, booking.provider_id, parsedRating, comment || null]);

      const statsQuery = 'SELECT AVG(rating) as avg_rating, COUNT(id) as count_rating FROM reviews WHERE provider_id = $1;';
      const statsRes = await clientDb.query(statsQuery, [booking.provider_id]);
      const avg = parseFloat(statsRes.rows[0].avg_rating) || 0.0;
      const count = parseInt(statsRes.rows[0].count_rating) || 0;

      const updateProviderQuery = 'UPDATE perfiles_prestador SET rating_avg = $1, rating_count = $2 WHERE id = $3;';
      await clientDb.query(updateProviderQuery, [avg, count, booking.provider_id]);

      await clientDb.query('COMMIT');

      res.json({
        success: true,
        message: 'Reseña publicada con éxito y reputación del proveedor actualizada',
        data: { rating_avg: avg, rating_count: count }
      });
    } catch (e) {
      await clientDb.query('ROLLBACK');
      throw e;
    } finally {
      clientDb.release();
    }

  } catch (error) {
    console.error('❌ ERROR EN POST /api/bookings/:id/review:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error interno al guardar la reseña' });
  }
};

// 🔹 INICIAR SERVICIO
exports.startService = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const providerId = req.user.id;

    const booking = await Booking.findOne({
      where: { id: bookingId, provider_id: providerId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para iniciarla' });
    }

    if (booking.estado !== 'CONFIRMADA') {
      return res.status(400).json({ error: `No se puede iniciar el servicio. El estado actual es ${booking.estado} (debe ser CONFIRMADA).` });
    }

    booking.estado = 'EN_PROGRESO';
    await booking.save();

    console.log(`🚀 Servicio iniciado para cita ${bookingId} por prestador ${providerId}`);

    res.json({
      success: true,
      message: 'Servicio iniciado con éxito',
      booking: {
        id: booking.id,
        status: booking.estado
      }
    });

  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/bookings/:id/start:', error);
    res.status(500).json({ error: 'Error interno al iniciar el servicio' });
  }
};

/**
 * Genera y envía la Factura Electrónica DIAN para una cita pagada.
 * Se ejecuta dentro de la transacción del webhook (no bloquea confirmación).
 */
async function generarFacturaDian(bookingId, transaction) {
  if (!dianInvoiceClient.isConfigured()) {
    console.info(`[DIAN INVOICE] Cliente no configurado (falta certificado/NIT). Saltando factura para cita ${bookingId}.`);
    return;
  }

  // Obtener datos completos de la cita con relaciones necesarias
  const booking = await Booking.findByPk(bookingId, {
    include: [
      { model: Service, as: 'service' },
      { model: User, as: 'client' },
      { model: User, as: 'provider' }
    ],
    transaction
  });

  if (!booking) {
    throw new Error(`Cita ${bookingId} no encontrada para facturación`);
  }

  // Datos del emisor (desde config/env)
  const emisorNit = process.env.DIAN_NIT;
  const emisorDv = process.env.DIAN_DV || '0';
  const emisorRazonSocial = process.env.DIAN_RAZON_SOCIAL || 'GlowApp S.A.S.';
  const emisorDireccion = process.env.DIAN_DIRECCION || 'Calle 100 # 7-21';
  const emisorMunicipio = process.env.DIAN_MUNICIPIO || '11001'; // Bogotá D.C.
  const emisorDepartamento = process.env.DIAN_DEPARTAMENTO || '11';
  const emisorTelefono = process.env.DIAN_TELEFONO || '+57 1 234 5678';
  const emisorEmail = process.env.DIAN_EMAIL || 'facturacion@glowapp.co';
  const emisorRutResponsabilidades = [48]; // Responsable de IVA

  // Datos del adquiriente (cliente)
  const client = booking.client;
  const provider = booking.provider;

  // Calcular desglose IVA (ya congelado en booking.iva_desglose)
  const ivaDesglose = booking.iva_desglose || { valor_iva: 0, base_gravable: booking.valor_bruto, tarifa: 19 };
  const subtotal = parseFloat(booking.valor_bruto) || 0;
  const totalImpuestos = parseFloat(ivaDesglose.valor_iva) || 0;
  const totalFactura = subtotal + totalImpuestos;

  // Preparar líneas
  const lineas = [];
  if (booking.service) {
    lineas.push({
      cantidad: 1,
      unidad: '94', // Unidad de servicio
      descripcion: booking.service.name || 'Servicio de belleza',
      valorUnitario: subtotal,
      ivaPorcentaje: ivaDesglose.tarifa || 19,
      codigo: booking.service.id
    });
  }

  // Productos adicionales
  if (booking.productos_adicionales && Array.isArray(booking.productos_adicionales)) {
    const products = Array.isArray(booking.productos_adicionales.products)
      ? booking.productos_adicionales.products
      : booking.productos_adicionales;
    products.forEach(p => {
      const pSubtotal = parseFloat(p.precio_unitario) * p.cantidad;
      const pIva = pSubtotal * (p.iva_porcentaje || 19) / 100;
      lineas.push({
        cantidad: p.cantidad,
        unidad: '94',
        descripcion: p.nombre || 'Producto',
        valorUnitario: parseFloat(p.precio_unitario),
        ivaPorcentaje: p.iva_porcentaje || 19,
        codigo: p.id
      });
    });
  }

  const now = new Date();
  const fechaEmision = now.toISOString().split('T')[0];
  const horaEmision = now.toTimeString().split(' ')[0];

  // Generar XML UBL 2.1
  const xmlFirmado = await dianInvoiceClient.generarFacturaXml({
    numeroFactura: `FAC-${bookingId}`,
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
    adquirienteTipoDoc: client.document_type === 'CC' ? 13 : 31,
    adquirienteNumeroDoc: client.document_number,
    adquirienteDv: client.document_dv || '0',
    adquirienteRazonSocial: `${client.first_name} ${client.last_name}`,
    adquirienteDireccion: client.address || 'Sin dirección',
    adquirienteMunicipio: client.city_code || '11001',
    adquirienteDepartamento: client.state_code || '11',
    adquirienteTelefono: client.phone || 'N/A',
    adquirienteEmail: client.email,

    // Líneas y totales
    lineas,
    subtotal,
    totalDescuentos: 0,
    totalCargos: 0,
    totalImpuestos,
    totalFactura,

    observaciones: `Cita ${bookingId} - Servicio: ${booking.service?.name}`
  });

  // Enviar a DIAN / Proveedor
  const resultado = await dianInvoiceClient.enviarFactura(xmlFirmado, `FAC-${bookingId}`);

  if (!resultado.aceptada) {
    throw new Error(`Factura rechazada por DIAN: ${JSON.stringify(resultado.respuesta)}`);
  }

  // Guardar CUFE y QR en la cita (campo nuevo o metadata)
  await Booking.update(
    {
      cufe: resultado.cufe,
      qr_factura: resultado.qr,
      factura_emitida: true,
      factura_fecha: new Date()
    },
    { where: { id: bookingId }, transaction }
  );

  console.log(`✅ [DIAN INVOICE] Factura emitida para cita ${bookingId} - CUFE: ${resultado.cufe}`);
}

module.exports = { ...exports, generarFacturaDian };
