// backend/src/controllers/bookingController.js
const { pool } = require('../config/db');
const { runAsSystem, runAsSystemContext } = require('../config/tenantRouting');
const { Booking, Service, User, Transaction } = require('../models');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const crypto = require('crypto');
const dianInvoiceClient = require('../services/dianInvoiceClient');
const { construirRecibo } = require('../services/receiptService');
const jwt = require('jsonwebtoken');
const { maskEmail } = require('../utils/piiSanitizer');
const { getJwtSecret } = require('../config/jwt');
// OJO: email.service.js solo envía por Resend/SendGrid y, sin claves, SIMULA
// (devuelve éxito y no manda nada). Producción usa Brevo por API HTTP.
const emailService = require('../services/emailService');

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
const { dedupeServiceIds, missingServiceIds } = require('../utils/serviceSelection');
const usageMeteringService = require('../services/usageMeteringService');
const { getMonthPeriod } = require('../config/saasCatalog');
const { getColombiaDayRange, getColombiaSchedule, intersectColombiaSchedules, isWithinColombiaSchedule } = require('../utils/bookingCalendar');
const { getActiveBookingSalonId, canManageBooking } = require('../utils/bookingAccess');
const { isSaasDirectBookingAudience, bookingOriginForAudience } = require('../utils/bookingOrigin');
const { ACTIONS } = require('../services/authorizationService');
const { evaluarElegibilidadReserva } = require('../utils/bookingEligibility');

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

/**
 * `services.business_profile_id` existe en producción pero no en las
 * migraciones del repo (deriva de esquema). Se comprueba una vez por proceso
 * para no pedir una columna inexistente en una base recién creada.
 */
let _servicesTieneBusinessProfileId = null;
async function servicesTieneBusinessProfileId(transaction) {
  if (_servicesTieneBusinessProfileId !== null) return _servicesTieneBusinessProfileId;
  const filas = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'services'
        AND column_name = 'business_profile_id'`,
    { type: sequelize.QueryTypes.SELECT, transaction }
  );
  _servicesTieneBusinessProfileId = filas.length > 0;
  return _servicesTieneBusinessProfileId;
}

// 🔹 CREAR RESERVA
exports.createBooking = async (req, res) => {
  try {
    const clientId = req.user.id;
    let { provider_id, service_id, service_ids, scheduled_at, service_address, notes, productos_adicionales } = req.body;
    const salonIdInput = req.body.salon_id ?? req.body.salonId ?? null;

    // Un `provider_id` no numérico hacía que Postgres reventara con
    // «invalid input syntax for type integer» y el cliente viera un 500.
    const parsedProviderId = Number(provider_id);
    if (!/^\d+$/.test(String(provider_id ?? '')) ||
        !Number.isSafeInteger(parsedProviderId) || parsedProviderId <= 0 || parsedProviderId > 2147483647) {
      return res.status(400).json({
        success: false,
        code: 'BOOKING_PROVIDER_INVALID',
        error: 'provider_id inválido',
      });
    }

    // Los ids se deduplican ANTES de comparar: un id repetido no es un
    // servicio inexistente, y el conteo anterior lo trataba como tal.
    const idsPedidos = dedupeServiceIds(
      Array.isArray(service_ids)
        ? service_ids
        : String(service_ids ?? service_id ?? '').split(',')
    );

    if (idsPedidos.length === 0 || !scheduled_at) {
      return res.status(400).json({
        success: false,
        code: 'BOOKING_FIELDS_MISSING',
        error: 'Faltan campos requeridos o formato inválido para service_ids',
      });
    }
    if (Number.isNaN(new Date(scheduled_at).getTime())) {
      return res.status(400).json({ success: false, code: 'BOOKING_DATETIME_INVALID', error: 'Fecha de reserva inválida.' });
    }

    // Obtener y validar todos los servicios solicitados.
    //
    // CROSS-TENANT: el cliente pertenece a un inquilino y los servicios son del
    // inquilino del prestador. Con el contexto del cliente, RLS los hace
    // invisibles y `findAll` devuelve 0 filas → 404 «Uno o más servicios no
    // fueron encontrados» con un servicio válido. La lectura se hace con el rol
    // de sistema (app_system, BYPASSRLS) en su propia transacción; el
    // aislamiento del resto de la API no cambia.
    const { provider, services, prestadorFiscal, providerBusinessProfileCount } = await sequelize.transaction(async (t) => {
      await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
      const providers = await sequelize.query(
        `SELECT u.is_active, u.estado_operativo, p.estatus_verificacion
           FROM usuarios u
           LEFT JOIN perfiles_prestador p ON p.id = u.id
          WHERE u.id = :providerId`,
        {
          replacements: { providerId: Number(provider_id) },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );
      const provider = providers[0] || null;
      // Un servicio puede pertenecer al prestador O a uno de sus perfiles de
      // negocio (así los lista serviceController.getProviderServices). Filtrar
      // sólo por provider_id hacía que un servicio elegible diera 404 SIEMPRE.
      const tienePerfilNegocio = await servicesTieneBusinessProfileId(t);
      const negocios = tienePerfilNegocio
        ? await sequelize.query(
            'SELECT id FROM business_profiles WHERE provider_id = :providerId',
            {
              replacements: { providerId: Number(provider_id) },
              type: sequelize.QueryTypes.SELECT,
              transaction: t,
            }
          )
        : [];
      const businessIds = negocios.map((n) => n.id);
      const filas = await Service.findAll({
        where: {
          id: idsPedidos,
          is_active: true,
          [Op.or]: [
            { provider_id: Number(provider_id) },
            ...(businessIds.length
              ? [{ business_profile_id: { [Op.in]: businessIds } }]
              : []),
          ],
        },
        transaction: t,
      });
      // Condición tributaria del PRESTADOR, leída de SU cuenta — nunca del
      // request: un cliente no puede decidir la carga tributaria de la
      // operación (migración 086: art. 476 num. 1 lit. a y art. 437 par. 3 ET).
      const fiscal = await sequelize.query(
        'SELECT responsable_iva, tarifa_iva FROM usuarios WHERE id = :providerId;',
        {
          replacements: { providerId: provider_id },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );
      return {
        provider,
        services: filas,
        prestadorFiscal: fiscal,
        providerBusinessProfileCount: negocios.length,
      };
    });

    const elegibilidad = evaluarElegibilidadReserva(provider);
    if (!elegibilidad.permitido) {
      return res.status(elegibilidad.status).json({
        success: false,
        code: elegibilidad.code,
        error: elegibilidad.error,
      });
    }

    // 404 estructurado: además del mensaje, se dice QUÉ ids no existen para
    // que la app pueda limpiar la selección y reintentar en vez de mostrar
    // «Exception: …» a la clienta.
    const faltantes = missingServiceIds(idsPedidos, services);
    if (faltantes.length > 0) {
      console.warn('[BOOKING] servicios no encontrados', {
        traceId: req.traceId,
        provider_id,
        solicitados: idsPedidos.length,
        faltantes,
      });
      return res.status(404).json({
        success: false,
        code: 'SERVICES_NOT_FOUND',
        error: 'Uno o más servicios no fueron encontrados',
        missing_service_ids: faltantes,
      });
    }
    const responsableIva =
      prestadorFiscal.length > 0 && prestadorFiscal[0].responsable_iva === true;
    const tarifaIvaAplicada = responsableIva
      ? Number(prestadorFiscal[0].tarifa_iva ?? 0.19)
      : 0;

    // Ordenar los servicios en base al orden recibido en service_ids
    const servicesMap = {};
    services.forEach(s => { servicesMap[s.id] = s; });
    const orderedServices = idsPedidos.map((id) => servicesMap[id]);

    if (providerBusinessProfileCount > 0 && orderedServices.some((service) => !service.business_profile_id)) {
      return res.status(409).json({
        success: false,
        code: 'BOOKING_SERVICE_SCOPE_UNRESOLVED',
        error: 'Uno o más servicios aún no están asignados a un negocio. El prestador debe asignarlos antes de habilitar reservas SaaS.',
      });
    }

    const serviceBusinessProfiles = [...new Set(orderedServices
      .map((service) => service.business_profile_id || null)
      .filter(Boolean)
      .map(String))];
    const serviceSalons = [...new Set(orderedServices
      .map((service) => service.salon_id || null)
      .filter(Boolean)
      .map(Number))];
    if (serviceBusinessProfiles.length > 1 || serviceSalons.length > 1) {
      return res.status(400).json({
        success: false,
        code: 'BOOKING_SCOPE_MISMATCH',
        error: 'Los servicios seleccionados no pertenecen al mismo negocio y sede.',
      });
    }

    const parsedSalonId = salonIdInput === null ? null : Number(salonIdInput);
    if (salonIdInput !== null && (!/^\d+$/.test(String(salonIdInput)) ||
        !Number.isSafeInteger(parsedSalonId) || parsedSalonId <= 0 || parsedSalonId > 2147483647)) {
      return res.status(400).json({ success: false, code: 'BOOKING_SALON_INVALID', error: 'salon_id inválido' });
    }
    let salonId = salonIdInput === null ? (serviceSalons[0] || null) : parsedSalonId;
    let businessProfileId = serviceBusinessProfiles[0] || null;
    if (salonId !== null) {
      const salonRows = await sequelize.transaction(async (t) => {
        await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
        return sequelize.query(
          `SELECT s.id, s.business_profile_id
             FROM salones s
            WHERE s.id = :salonId
              AND (:businessProfileId IS NULL OR s.business_profile_id = :businessProfileId)
              AND (
                (:businessProfileId IS NOT NULL AND s.business_profile_id = :businessProfileId
                  AND EXISTS (
                    SELECT 1 FROM business_profiles bp
                     WHERE bp.id = s.business_profile_id
                       AND (bp.provider_id = :providerId OR EXISTS (
                         SELECT 1 FROM memberships m
                          WHERE m.business_profile_id = bp.id
                            AND m.user_id = :providerId
                            AND m.status = 'ACTIVE'
                       ))
                  ))
                OR (:businessProfileId IS NULL AND (
                  (s.business_profile_id IS NULL AND s.id_dueno = :providerId)
                  OR EXISTS (
                    SELECT 1 FROM business_profiles bp
                     WHERE bp.id = s.business_profile_id
                       AND (bp.provider_id = :providerId OR EXISTS (
                         SELECT 1 FROM memberships m
                          WHERE m.business_profile_id = bp.id
                            AND m.user_id = :providerId
                            AND m.status = 'ACTIVE'
                       ))
                  )
                ))
              )`,
          {
            replacements: { salonId, businessProfileId, providerId: Number(provider_id) },
            type: sequelize.QueryTypes.SELECT,
            transaction: t,
          }
        );
      });
      if (!salonRows.length) {
        return res.status(404).json({ success: false, code: 'BOOKING_SALON_NOT_FOUND', error: 'La sede no existe.' });
      }
      const salonBusinessProfileId = salonRows[0].business_profile_id || null;
      if (serviceSalons.length && serviceSalons[0] !== salonId) {
        return res.status(400).json({ success: false, code: 'BOOKING_SCOPE_MISMATCH', error: 'El servicio no pertenece a la sede seleccionada.' });
      }
      if (businessProfileId && salonBusinessProfileId && String(businessProfileId) !== String(salonBusinessProfileId)) {
        return res.status(400).json({ success: false, code: 'BOOKING_SCOPE_MISMATCH', error: 'La sede y el servicio pertenecen a negocios distintos.' });
      }
      businessProfileId = businessProfileId || salonBusinessProfileId;
      if (businessProfileId && orderedServices.some((service) => !service.business_profile_id)) {
        return res.status(409).json({
          success: false,
          code: 'BOOKING_SERVICE_SCOPE_UNRESOLVED',
          error: 'Uno o más servicios aún no están asignados al negocio de esta sede. El prestador debe asignarlos antes de habilitar reservas.',
        });
      }
    } else if (businessProfileId) {
      const salonRows = await sequelize.transaction(async (t) => {
        await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
        return sequelize.query(
          'SELECT id FROM salones WHERE business_profile_id = :businessProfileId ORDER BY id LIMIT 2',
          { replacements: { businessProfileId }, type: sequelize.QueryTypes.SELECT, transaction: t }
        );
      });
      if (salonRows.length > 1) {
        return res.status(400).json({
          success: false,
          code: 'BOOKING_SALON_REQUIRED',
          error: 'Selecciona la sede donde quieres reservar.',
        });
      }
      if (salonRows.length === 1) salonId = Number(salonRows[0].id);
    }

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

    // 🔸 Duplicado por doble toque, ANTES del control de solape.
    // Si se deja después, el propio duplicado choca contra la agenda y el
    // segundo toque recibe un 409 «horario ya reservado» en lugar de la cita
    // que el usuario acaba de crear.
    const reciente = await sequelize.query(
      `SELECT candidate.id FROM bookings candidate
        WHERE candidate.client_id = :clientId
          AND candidate.provider_id = :providerId
          AND candidate.scheduled_at = :scheduledAt
          AND candidate.salon_id IS NOT DISTINCT FROM :salonId
          AND candidate.estado = 'PENDIENTE_PAGO'
          AND COALESCE(candidate.productos_adicionales->>'is_primary', 'true') = 'true'
          AND candidate.created_at > now() - interval '2 minutes'
          AND array_to_string(ARRAY(
            SELECT grouped.service_id::text
              FROM bookings grouped
             WHERE COALESCE(grouped.productos_adicionales->>'primary_booking_id', grouped.id::text) = candidate.id::text
             ORDER BY CASE
               WHEN grouped.productos_adicionales->>'group_position' ~ '^-?[0-9]+$'
                 THEN (grouped.productos_adicionales->>'group_position')::integer
               ELSE 0
             END, grouped.id
          ), ',') = :serviceIds
        LIMIT 1`,
      {
        replacements: {
          clientId,
          providerId: Number(provider_id),
          scheduledAt: new Date(scheduled_at),
          salonId,
          serviceIds: idsPedidos.join(','),
        },
        type: sequelize.QueryTypes.SELECT,
      }
    );
    if (reciente.length > 0) {
      return res.status(200).json({
        success: true,
        booking_id: reciente[0].id,
        idempotente: true,
      });
    }

    const newStart = new Date(scheduled_at);
    const newEnd = new Date(newStart.getTime() + totalDurationMinutes * 60 * 1000);
    const bookingDay = getColombiaDayRange(newStart);
    if (!bookingDay) {
      return res.status(400).json({ success: false, code: 'BOOKING_DATETIME_INVALID', error: 'Fecha de reserva inválida.' });
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
      await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });

      // Serializa las reservas del mismo prestador y día local; la comprobación
      // y la escritura usan este mismo lock transaccional.
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(:providerId, hashtext(:localDate))',
        { replacements: { providerId: Number(provider_id), localDate: bookingDay.localDate }, transaction: t }
      );

      const providerHours = await sequelize.query(
        `SELECT p.active_start_hour, p.active_end_hour, p.weekly_schedule, s.horario_atencion
           FROM perfiles_prestador p
           LEFT JOIN salones s ON s.id = :salonId
          WHERE p.id = :providerId`,
        { replacements: { providerId: Number(provider_id), salonId: targetSalonId }, type: sequelize.QueryTypes.SELECT, transaction: t }
      );
      const hours = providerHours[0] || {};
      const providerSchedule = getColombiaSchedule({
        date: bookingDay.localDate,
        weeklySchedule: hours.weekly_schedule,
        activeStartHour: hours.active_start_hour,
        activeEndHour: hours.active_end_hour,
      });
      const schedule = intersectColombiaSchedules(providerSchedule, hours.horario_atencion, bookingDay.localDate);
      if (!isWithinColombiaSchedule({
        scheduledAt: newStart,
        durationMinutes: totalDurationMinutes,
        schedule,
      })) {
        throw Object.assign(new Error('El horario ya no está disponible o está fuera del horario del prestador.'), {
          code: 'BOOKING_SLOT_INVALID',
        });
      }

      // Idempotencia natural: dos toques seguidos en «Reservar» generaban dos
      // citas idénticas que el cliente tenía que cancelar a mano. Se compara el
      // grupo exacto de servicios y sede: compartir prestador/hora no basta.
      const duplicada = await sequelize.query(
        `SELECT candidate.id FROM bookings candidate
          WHERE candidate.client_id = :clientId
            AND candidate.provider_id = :providerId
            AND candidate.scheduled_at = :scheduledAt
            AND candidate.salon_id IS NOT DISTINCT FROM :salonId
            AND candidate.estado = 'PENDIENTE_PAGO'
            AND COALESCE(candidate.productos_adicionales->>'is_primary', 'true') = 'true'
            AND candidate.created_at > now() - interval '2 minutes'
            AND array_to_string(ARRAY(
              SELECT grouped.service_id::text
                FROM bookings grouped
               WHERE COALESCE(grouped.productos_adicionales->>'primary_booking_id', grouped.id::text) = candidate.id::text
               ORDER BY CASE
                 WHEN grouped.productos_adicionales->>'group_position' ~ '^-?[0-9]+$'
                   THEN (grouped.productos_adicionales->>'group_position')::integer
                 ELSE 0
               END, grouped.id
            ), ',') = :serviceIds
          LIMIT 1`,
        {
          replacements: {
            clientId,
            providerId: Number(provider_id),
            scheduledAt: new Date(scheduled_at),
            salonId,
            serviceIds: idsPedidos.join(','),
          },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (duplicada.length > 0) {
        throw Object.assign(new Error('reserva duplicada'), {
          code: 'RESERVA_DUPLICADA',
          bookingId: duplicada[0].id,
        });
      }
      if (newStart.getTime() <= Date.now()) {
        throw Object.assign(new Error('Selecciona una fecha y hora futura.'), {
          code: 'BOOKING_DATETIME_PAST',
        });
      }

      const existingBookings = await sequelize.query(`
        SELECT b.scheduled_at, COALESCE(s.duration_minutes, 60) AS duration_minutes
          FROM bookings b
          LEFT JOIN services s ON s.id = b.service_id
         WHERE b.provider_id = :providerId
           AND b.estado::text NOT IN ('CANCELADA', 'CANCELLED')
           AND b.scheduled_at >= :dayStart
           AND b.scheduled_at < :dayEnd
      `, {
        replacements: {
          providerId: Number(provider_id),
          dayStart: bookingDay.start,
          dayEnd: bookingDay.endExclusive,
        },
        type: sequelize.QueryTypes.SELECT,
        transaction: t,
      });
      const collision = existingBookings.some((booking) => {
        const start = new Date(booking.scheduled_at);
        const end = new Date(start.getTime() + Number(booking.duration_minutes || 60) * 60_000);
        return newStart.getTime() < end.getTime() && newEnd.getTime() > start.getTime();
      });
      if (collision) {
        throw Object.assign(new Error('El horario seleccionado ya está reservado o entra en conflicto con otra cita.'), {
          code: 'BOOKING_SLOT_TAKEN',
        });
      }

      // Medir y aplicar reservas SaaS dentro de la misma transacción que crea
      // las citas. Así una carrera no permite superar el límite mensual y una
      // reserva duplicada no consume cuota.
      // Solo una reserva creada desde la app del salón consume la cuota
      // comercial de reservas directas. Las reservas de clientes del
      // marketplace se procesan igual, pero no entran en este contador.
      const serviciosPorTenant = new Map();
      const isDirectProviderBooking = isSaasDirectBookingAudience(req.appAudience);
      if (isDirectProviderBooking) {
      if (businessProfileId) serviciosPorTenant.set(String(businessProfileId), 1);
      const servicesHaveTenantColumn = await servicesTieneBusinessProfileId(t);
      if (serviciosPorTenant.size === 0 && servicesHaveTenantColumn) {
        const serviceTenants = await sequelize.query(
          'SELECT business_profile_id FROM services WHERE id IN (:serviceIds) AND business_profile_id IS NOT NULL',
          { replacements: { serviceIds: orderedServices.map((service) => service.id) }, type: sequelize.QueryTypes.SELECT, transaction: t }
        );
        for (const service of serviceTenants) {
          if (service.business_profile_id) serviciosPorTenant.set(String(service.business_profile_id), 1);
        }
      }
      if (serviciosPorTenant.size === 0) {
        const providerTenants = await sequelize.query(
          'SELECT id FROM business_profiles WHERE provider_id = :providerId',
          { replacements: { providerId: Number(provider_id) }, type: sequelize.QueryTypes.SELECT, transaction: t }
        );
        // La relación antigua provider_id sólo es inequívoca para una cuenta
        // con un perfil comercial. En cuentas multi-sede se exige que el
        // servicio lleve business_profile_id explícito.
        if (providerTenants.length === 1) serviciosPorTenant.set(String(providerTenants[0].id), 1);
      }
      for (const [tenantId, delta] of serviciosPorTenant) {
        const tenants = await sequelize.query(
          'SELECT saas_plan, provider_id FROM business_profiles WHERE id = :tenantId FOR UPDATE',
          { replacements: { tenantId }, type: sequelize.QueryTypes.SELECT, transaction: t }
        );
        if (tenants.length === 0) continue;
        const plan = tenants[0].saas_plan || 'FREEMIUM';
        const limit = usageMeteringService.getLimit(plan, 'DIRECT_BOOKINGS');
        const { start: periodStart, end: periodEnd } = getMonthPeriod();
        const existingUsage = await sequelize.query(
          `SELECT count FROM usage_metrics WHERE tenant_id = :tenantId AND feature = 'DIRECT_BOOKINGS' AND period_start = :periodStart`,
          { replacements: { tenantId, periodStart }, type: sequelize.QueryTypes.SELECT, transaction: t }
        );
        let currentUsage = Number(existingUsage[0]?.count || 0);
        if (existingUsage.length === 0) {
          // Inicialización transparente para el mes en curso: toma el historial
          // de reservas previo a activar la medición, sin resetear ni perder datos.
          const historicalQuery = servicesHaveTenantColumn
            ? `SELECT COUNT(DISTINCT COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text))::integer AS count
               FROM bookings b
               JOIN services s ON s.id = b.service_id
               WHERE s.business_profile_id = :tenantId
                 AND b.created_at >= CAST(:periodStart AS date)
                 AND b.created_at < (CAST(:periodStart AS date) + INTERVAL '1 month')
                 AND b.productos_adicionales->>'booking_origin' = 'SALON_DIRECT'
                 AND COALESCE((b.productos_adicionales->>'is_primary')::boolean, true) = true`
            : `SELECT COUNT(DISTINCT COALESCE(productos_adicionales->>'primary_booking_id', id::text))::integer AS count
               FROM bookings
               WHERE provider_id = :providerId
                 AND created_at >= CAST(:periodStart AS date)
                 AND created_at < (CAST(:periodStart AS date) + INTERVAL '1 month')
                 AND productos_adicionales->>'booking_origin' = 'SALON_DIRECT'
                 AND COALESCE((productos_adicionales->>'is_primary')::boolean, true) = true`;
          const historicalRows = await sequelize.query(historicalQuery, {
            replacements: {
              tenantId,
              providerId: tenants[0].provider_id,
              periodStart,
            },
            type: sequelize.QueryTypes.SELECT,
            transaction: t,
          });
          currentUsage = Number(historicalRows[0]?.count || 0);
        }
        if (limit === 0 || (limit !== null && currentUsage + delta > limit)) {
          throw Object.assign(new Error('límite mensual de reservas alcanzado'), {
            code: 'SAAS_QUOTA_EXCEEDED', feature: 'DIRECT_BOOKINGS', limit, current: currentUsage, plan,
          });
        }
        const usageRows = await sequelize.query(`
          INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
          VALUES (:tenantId, 'DIRECT_BOOKINGS', :periodStart, :periodEnd, :initialCount, :limit)
          ON CONFLICT (tenant_id, feature, period_start)
          DO UPDATE SET
            count = usage_metrics.count + EXCLUDED.count,
            "limit" = EXCLUDED."limit",
            updated_at = NOW()
          WHERE EXCLUDED."limit" IS NULL
             OR usage_metrics.count + EXCLUDED.count <= EXCLUDED."limit"
          RETURNING count;
        `, {
          replacements: {
            tenantId, periodStart, periodEnd, limit,
            initialCount: existingUsage.length === 0 ? currentUsage + delta : delta,
          },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        });
        if (usageRows.length === 0) {
          const currentRows = await sequelize.query(
            `SELECT count FROM usage_metrics WHERE tenant_id = :tenantId AND feature = 'DIRECT_BOOKINGS' AND period_start = :periodStart`,
            { replacements: { tenantId, periodStart }, type: sequelize.QueryTypes.SELECT, transaction: t }
          );
          throw Object.assign(new Error('límite mensual de reservas alcanzado'), {
            code: 'SAAS_QUOTA_EXCEEDED', feature: 'DIRECT_BOOKINGS', limit,
          current: Number(currentRows[0]?.count ?? currentUsage), plan,
          });
        }
      }
      }

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
          booking_origin: bookingOriginForAudience(req.appAudience),
          linked_booking_ids: generatedIds.filter(id => id !== currentId),
          is_primary: isPrimary,
          primary_booking_id: generatedIds[0],
          group_position: i
        };

        const booking = await Booking.create({
          id: currentId,
          client_id: clientId,
          provider_id: Number(provider_id),
          service_id: currentService.id,
          business_profile_id: currentService.business_profile_id || businessProfileId,
          salon_id: currentService.salon_id || salonId,
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
    if (error.code === 'RESERVA_DUPLICADA') {
      // Segundo toque del usuario: misma cita, sin crear otra.
      return res.status(200).json({
        success: true,
        booking_id: error.bookingId,
        idempotente: true,
      });
    }
    if (error.code === 'BOOKING_DATETIME_PAST') {
      return res.status(400).json({ success: false, code: error.code, error: error.message });
    }
    if (error.code === 'SAAS_QUOTA_EXCEEDED') {
      return res.status(429).json({
        success: false,
        code: 'SAAS_QUOTA_EXCEEDED',
        error: 'El plan alcanzó su límite mensual de reservas.',
        feature: error.feature,
        current: error.current,
        limit: error.limit,
        currentPlan: error.plan,
        upgradeUrl: '/api/saas/billing/checkout',
      });
    }
    if (error.code === 'BOOKING_SLOT_TAKEN') {
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }
    if (error.code === 'BOOKING_SLOT_INVALID') {
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }
    console.error('❌ ERROR EN /api/bookings:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error al crear la reserva' });
  }
};

// 🔹 Panel de Prestador: Obtener citas
exports.getProviderBookings = async (req, res) => {
  try {
    // Usamos pool para queries directas si son a tablas no mapeadas (o complejas), 
    // La propiedad/operación se decide en SQL (titular o membresía operativa), no por el rol
    // global del usuario: los empleados SaaS pueden tener rol CLIENTE en auth.
    const query = `
      SELECT 
        b.id, b.booking_number, b.scheduled_at, b.estado AS status, b.payment_status, b.valor_bruto AS total_amount,
        b.comision_plataforma AS platform_commission, b.impuestos_estado AS state_tax, b.pago_neto_prestador AS provider_net_amount,
        b.client_id, b.service_id, b.pin_verificacion, b.service_address,
        s.name as service_name, s.price,
        u.nombre as client_name, u.phone as client_phone,
        t.external_id AS wompi_reference, t.status AS payout_status
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN usuarios u ON b.client_id = u.id
      LEFT JOIN transactions t ON b.id = t.booking_id
      WHERE (
        (b.provider_id = $1 AND (
          (b.business_profile_id IS NULL OR EXISTS (
            SELECT 1 FROM business_profiles owner_profile
             WHERE owner_profile.id = b.business_profile_id AND owner_profile.provider_id = $1
          ))
          AND (
          ($2::integer IS NULL AND b.salon_id IS NULL)
          OR ($2::integer IS NOT NULL AND b.salon_id = $2 AND EXISTS (
            SELECT 1 FROM salones selected_owner_salon
             WHERE selected_owner_salon.id = $2
               AND (
                 (b.business_profile_id IS NULL AND selected_owner_salon.business_profile_id IS NULL AND selected_owner_salon.id_dueno = $1)
                 OR (selected_owner_salon.business_profile_id = b.business_profile_id AND EXISTS (
                   SELECT 1 FROM business_profiles owner_profile
                    WHERE owner_profile.id = selected_owner_salon.business_profile_id
                      AND owner_profile.provider_id = $1
                 ))
               )
          ))
          )
        ))
        OR (
          b.business_profile_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memberships m
             WHERE m.business_profile_id = b.business_profile_id
               AND m.user_id = $1 AND m.status = 'ACTIVE'
               -- memberships.role es canónico. VIEWER puede consultar agenda,
               -- pero el helper de escritura aplica acciones RBAC por separado.
               AND m.role IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER')
               AND (($2::integer IS NULL AND b.salon_id IS NULL) OR EXISTS (
                 SELECT 1 FROM salones selected_salon
                  WHERE selected_salon.id = $2
                    AND selected_salon.business_profile_id = b.business_profile_id
                    AND (b.salon_id IS NULL OR b.salon_id = selected_salon.id)
               ))
               AND (b.salon_id IS NULL OR EXISTS (
                 SELECT 1 FROM salones booking_salon
                  WHERE booking_salon.id = b.salon_id
                    AND booking_salon.business_profile_id = b.business_profile_id
               ))
          )
        )
      )
      ORDER BY b.scheduled_at ASC;
    `;

    const salonId = getActiveBookingSalonId(req);
    if (Number.isNaN(salonId)) {
      return res.status(400).json({ error: 'salon_id inválido.' });
    }
    const result = await runAsSystem({ pool }, (client) => client.query(query, [req.user.id, salonId]));
    
    const formattedBookings = result.rows.map(row => ({
      id: row.id,
      booking_number: row.booking_number,
      client_id: row.client_id ? row.client_id.toString() : '5',
      scheduled_at: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      status: row.status,
      // Ítem 31: solo las citas pagadas tienen recibo.
      payment_status: row.payment_status || null,
      total_amount: parseFloat(row.total_amount) || 0,
      platform_commission: parseFloat(row.platform_commission) || 0,
      state_tax: parseFloat(row.state_tax) || 0,
      provider_net_amount: parseFloat(row.provider_net_amount) || 0,
      service_id: row.service_id,
      service_name: row.service_name,
      price: parseFloat(row.price) || 0,
      client_name: row.client_name,
      client_phone: row.client_phone,
      service_address: row.service_address || '',
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
    const mapStatusToDb = (status) => {
      if (typeof status !== 'string' || !status.trim()) return '';
      const s = status.toUpperCase();
      return s;
    };

    const dbStatus = mapStatusToDb(status);

    // Esta ruta queda limitada al cambio operativo que usa la app para escalar
    // una cita a soporte. Pago, inicio, finalización y cancelación tienen rutas
    // propias que validan sus efectos (Wompi/OTP/reembolso); permitirlos aquí
    // saltaría partes del ciclo comercial.
    const validStatuses = ['EN_DISPUTA'];
    if (!validStatuses.includes(dbStatus)) {
      return res.status(400).json({ error: `Estado inválido. Permitidos: ${validStatuses.join(', ')}` });
    }

    if (!(await canManageBooking(req, bookingId))) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }

    const booking = await runAsSystemContext(() => Booking.findByPk(bookingId));

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }

    booking.estado = dbStatus;
    await runAsSystemContext(() => booking.save());

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
        b.id, b.booking_number, b.scheduled_at, b.estado AS status, b.payment_status, b.valor_bruto AS total_amount, b.service_address, b.notes, b.pin_verificacion,
        b.service_id, b.provider_id, b.salon_id,
        b.productos_adicionales->>'primary_booking_id' AS primary_booking_id,
        CASE WHEN jsonb_typeof(b.productos_adicionales->'linked_booking_ids') = 'array'
             THEN b.productos_adicionales->'linked_booking_ids' ELSE '[]'::jsonb END AS linked_booking_ids,
        group_services.service_ids,
        s.name as service_name, s.duration_minutes as service_duration,
        u_prov.nombre as provider_name,
        p.business_name as provider_business_name,
        u_prov.foto_url as provider_avatar_url,
        u_prov.phone as provider_phone,
        r.id as review_id, r.rating as review_rating, r.comment as review_comment,
        re.estado as refund_status, re.monto as refund_monto,
        re.porcentaje_devolucion as refund_porcentaje
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN perfiles_prestador p ON b.provider_id = p.id
      JOIN usuarios u_prov ON p.id = u_prov.id
      LEFT JOIN reviews r ON b.id = r.booking_id
      LEFT JOIN reembolsos re ON re.booking_id = b.id
      LEFT JOIN LATERAL (
        SELECT array_agg(g.service_id::text ORDER BY g.scheduled_at, g.id) AS service_ids
          FROM bookings g
         WHERE g.id::text = COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text)
            OR g.id::text = ANY(ARRAY(
                 SELECT jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(b.productos_adicionales->'linked_booking_ids') = 'array'
                        THEN b.productos_adicionales->'linked_booking_ids' ELSE '[]'::jsonb END
                 )
               ))
      ) group_services ON TRUE
      WHERE b.client_id = $1
      ORDER BY b.scheduled_at DESC;
    `;
    
    // El cliente y el prestador están en inquilinos distintos: con el contexto
    // del cliente, RLS oculta services/perfiles_prestador/usuarios del prestador
    // y los INNER JOIN dejan la lista vacía aunque la reserva exista. Se lee con
    // rol de sistema; el filtro por client_id sigue acotando a sus reservas.
    const result = await sequelize.transaction(async (t) => {
      await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
      return sequelize.query(query, {
        bind: [clientId],
        type: sequelize.QueryTypes.SELECT,
        transaction: t,
      });
    }).then((rows) => ({ rows }));
    
    const formattedBookings = result.rows.map(row => ({
      id: row.id,
      booking_number: row.booking_number,
      scheduled_at: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
      status: row.status,
      // Ítem 31: solo las citas pagadas tienen recibo.
      payment_status: row.payment_status || null,
      total_amount: parseFloat(row.total_amount) || 0,
      service_address: row.service_address || '',
      notes: row.notes || '',
      // La reprogramación pide /providers/:id/slots?date&service_id: sin estos
      // dos campos el sheet abría la fecha pero no podía pedir horarios.
      service_id: row.service_id,
      provider_id: row.provider_id,
      salon_id: row.salon_id,
      primary_booking_id: row.primary_booking_id || row.id,
      linked_booking_ids: Array.isArray(row.linked_booking_ids) ? row.linked_booking_ids : [],
      service_ids: Array.isArray(row.service_ids) ? row.service_ids : [row.service_id].filter(Boolean),
      service_name: row.service_name,
      service_duration: parseInt(row.service_duration) || 0,
      provider_name: row.provider_name,
      provider_business_name: row.provider_business_name || '',
      provider_avatar_url: row.provider_avatar_url || '',
      provider_phone: row.provider_phone || '',
      is_reviewed: row.review_id !== null,
      // Ítem 30: el estado del reembolso no se mostraba en ninguna parte; el
      // usuario leía «cancelada» y no sabía si el dinero volvía.
      refund_status: row.refund_status || null,
      refund_monto: row.refund_monto != null ? parseFloat(row.refund_monto) : null,
      refund_porcentaje:
          row.refund_porcentaje != null ? parseFloat(row.refund_porcentaje) : null,
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

// 🔹 Recibo de la cita (ítem 31)
// Una sola consulta con rol de sistema: el cliente y el prestador viven en
// inquilinos distintos, así que con el contexto del cliente los JOIN dejarían
// la fila invisible (mismo motivo que en getClientBookings).
async function cargarReservaParaRecibo(bookingId, clientId) {
  return sequelize.transaction(async (t) => {
    await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
    const filas = await sequelize.query(
      `SELECT b.id, b.scheduled_at, b.estado, b.payment_status, b.valor_bruto,
              b.subtotal_base, b.iva_valor, b.tarifa_iva_aplicada, b.propina,
              s.name AS servicio, u.nombre AS prestador,
              p.business_name AS negocio,
              c.nombre AS cliente, c.email AS email_cliente
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         JOIN perfiles_prestador p ON p.id = b.provider_id
         JOIN usuarios u ON u.id = p.id
         JOIN usuarios c ON c.id = b.client_id
        WHERE b.id = :bookingId AND b.client_id = :clientId
        LIMIT 1`,
      {
        replacements: { bookingId, clientId },
        type: sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );
    return filas && filas[0] ? filas[0] : null;
  });
}

function reciboDesdeFila(fila, metodoPago) {
  return construirRecibo({
    id: fila.id,
    cliente: fila.cliente,
    prestador: fila.negocio || fila.prestador,
    servicio: fila.servicio,
    fechaCita: fila.scheduled_at,
    valorBruto: fila.valor_bruto,
    subtotalBase: fila.subtotal_base,
    ivaValor: fila.iva_valor,
    tarifaIva: fila.tarifa_iva_aplicada,
    propina: fila.propina,
    metodoPago: metodoPago || 'Wompi',
    paymentStatus: fila.payment_status,
    estado: fila.estado,
  });
}

/// GET /api/bookings/:id/receipt — comprobante imprimible/descargable.
exports.getBookingReceipt = async (req, res) => {
  try {
    const fila = await cargarReservaParaRecibo(req.params.id, req.user.id);
    if (!fila) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }
    const { html } = reciboDesdeFila(fila, req.query.metodo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition',
      `inline; filename="recibo-${String(fila.id).slice(0, 8)}.html"`);
    return res.send(html);
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings/:id/receipt:', {
      message: error.message,
      code: error.code,
    });
    return res.status(500).json({ error: 'No pudimos generar el recibo de esta cita' });
  }
};

/// POST /api/bookings/:id/receipt/email — manda el recibo al correo de la cuenta.
exports.emailBookingReceipt = async (req, res) => {
  try {
    const fila = await cargarReservaParaRecibo(req.params.id, req.user.id);
    if (!fila) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }
    if (!fila.email_cliente) {
      return res.status(409).json({ error: 'Tu cuenta no tiene un correo al que enviar el recibo' });
    }
    const { asunto, html, texto } = reciboDesdeFila(fila, req.body && req.body.metodo);
    const envio = await emailService.sendEmail({
      to: fila.email_cliente,
      subject: asunto,
      data: { html, text: texto },
    });
    const idMensaje = envio && envio.messageId ? envio.messageId : null;
    console.log(`[recibo] enviado a ${maskEmail(fila.email_cliente)} (cita ${fila.id}): ${idMensaje || 'sin id'}`);
    return res.json({
      success: true,
      enviado_a: fila.email_cliente,
      proveedor: envio && envio.via ? envio.via : null,
      id_mensaje: idMensaje,
    });
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings/:id/receipt/email:', { message: error.message });
    return res.status(502).json({ error: 'No pudimos enviar el recibo por correo' });
  }
};

// 🔹 Enlace de pago (Web Checkout de Wompi) para una cita pendiente
exports.createBookingPaymentLink = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;

    let booking = await Booking.findOne({
      where: { id: bookingId, client_id: clientId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }
    if (booking.estado === 'CONFIRMADA' || booking.payment_status === 'paid') {
      return res.status(409).json({ error: 'Esta cita ya está pagada' });
    }
    if (booking.estado !== 'PENDIENTE_PAGO') {
      return res.status(409).json({ error: `La cita está en estado ${booking.estado}` });
    }

    const amount = Math.round(Number(booking.valor_bruto));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Esta cita no tiene un valor pendiente de cobro' });
    }

    const publicKey = process.env.WOMPI_PUBLIC_KEY;
    if (!publicKey || (typeof wompiClient.isConfigured === 'function' && !wompiClient.isConfigured())) {
      return res.status(503).json({
        error: 'PAGO_NO_CONFIGURADO',
        message: 'La pasarela de pagos no está configurada.'
      });
    }

    // Wompi exige una referencia única por transacción. El webhook reconoce
    // `<bookingId>` y `<bookingId>-r<dígitos>` (ver procesarWebhookWompi), así
    // que el sufijo numérico mantiene ambos contratos.
    const reference = `${bookingId}-r${Date.now().toString().slice(-9)}`;
    const amountInCents = amount * 100;

    // La firma se calcula aquí: WOMPI_INTEGRITY_SECRET no puede viajar al cliente.
    const signature = wompiClient.createIntegritySignature({
      reference,
      amountInCents,
      currency: 'COP'
    });

    // Retorno a la app tras pagar. Wompi añade `?id=<transacción>` a esta URL;
    // con el enrutado por hash de Flutter el destino queda en
    // `/#/my-bookings?id=…`, que la app resuelve a su pantalla de citas (que ya
    // recarga al abrir y tiene pull-to-refresh).
    // Solo se aceptan orígenes propios: un redirect libre desde el cuerpo sería
    // un open redirect firmado por nosotros.
    const ORIGENES_PERMITIDOS = [
      'https://glowapp-client.web.app',
      'https://glowapp-provider.web.app'
    ];
    const redirectPermitido = (raw) => {
      if (!raw) return null;
      try {
        const u = new URL(String(raw));
        const origen = `${u.protocol}//${u.host}`;
        if (ORIGENES_PERMITIDOS.includes(origen)) return u.toString();
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.toString();
        return null;
      } catch {
        return null;
      }
    };
    const redirectUrl = redirectPermitido(req.body?.redirect_url)
      || process.env.WOMPI_REDIRECT_URL
      || null;

    const checkoutBase = process.env.WOMPI_CHECKOUT_URL || 'https://checkout.wompi.co/p/';
    const params = new URLSearchParams({
      'public-key': publicKey,
      currency: 'COP',
      'amount-in-cents': String(amountInCents),
      reference,
      'signature:integrity': signature
    });
    if (redirectUrl) {
      params.append('redirect-url', redirectUrl);
    }

    return res.json({
      success: true,
      url: `${checkoutBase}?${params.toString()}`,
      reference,
      amount,
      currency: 'COP',
      redirect_url: redirectUrl
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/bookings/:id/payment-link:', error.message);
    res.status(500).json({ error: 'No se pudo generar el enlace de pago' });
  }
};

// 🔹 Cancelar cita por cliente
const UUID_CITA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.cancelBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;

    // Un id mal formado reventaba dentro de Postgres con un 500
    // ('invalid input syntax for type uuid'). Es un 400 del cliente.
    if (!UUID_CITA.test(String(bookingId))) {
      return res.status(400).json({ error: 'Identificador de cita inválido' });
    }

    const booking = await Booking.findOne({
      where: { id: bookingId, client_id: clientId }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para cancelarla' });
    }

    let bookingMetadata = booking.productos_adicionales || {};
    if (typeof bookingMetadata === 'string') {
      try { bookingMetadata = JSON.parse(bookingMetadata); } catch (_) { bookingMetadata = {}; }
    }
    const primaryBookingId = bookingMetadata.primary_booking_id;
    if (primaryBookingId && String(primaryBookingId) !== String(booking.id)) {
      booking = await Booking.findOne({ where: { id: primaryBookingId, client_id: clientId } });
      if (!booking) return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar el pago vinculado a esta cita.' });
      bookingMetadata = booking.productos_adicionales || {};
      if (typeof bookingMetadata === 'string') {
        try { bookingMetadata = JSON.parse(bookingMetadata); } catch (_) { bookingMetadata = {}; }
      }
    }
    const rawLinkedIds = Array.isArray(bookingMetadata.linked_booking_ids)
      ? bookingMetadata.linked_booking_ids.map(String)
      : [];
    if (rawLinkedIds.some((id) => !UUID_CITA.test(id))) {
      return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar todos los servicios vinculados a esta reserva.' });
    }
    const bookingIds = [...new Set([String(booking.id), ...rawLinkedIds])];

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
      // La cancelación acredita saldos/stock que pueden pertenecer a otro tenant.
      // El dueño de la operación ya se verificó por client_id arriba; se escala
      // solo esta transacción para que sus asientos cruzados no fallen por RLS.
      await sequelize.query('SET LOCAL ROLE app_system', { transaction: t });
      const groupRows = await sequelize.query(
        `SELECT id, client_id, provider_id, estado, business_profile_id, salon_id
           FROM bookings
          WHERE id = ANY(ARRAY[:bookingIds]::uuid[])
          ORDER BY id FOR UPDATE`,
        { replacements: { bookingIds }, type: sequelize.QueryTypes.SELECT, transaction: t }
      );
      if (groupRows.length !== bookingIds.length || groupRows.some((row) =>
        String(row.client_id) !== String(clientId) || Number(row.provider_id) !== Number(booking.provider_id) ||
        String(row.business_profile_id || '') !== String(booking.business_profile_id || '') ||
        String(row.salon_id || '') !== String(booking.salon_id || ''))) {
        throw Object.assign(new Error('La reserva tiene servicios vinculados inconsistentes.'), { code: 'BOOKING_GROUP_INVALID' });
      }
      if (groupRows.some((row) => ['CANCELADA', 'COMPLETADA'].includes(row.estado))) {
        throw Object.assign(new Error('Uno de los servicios vinculados ya no se puede cancelar.'), { code: 'BOOKING_GROUP_STATE_CONFLICT' });
      }
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
      await sequelize.query(
        `UPDATE bookings SET estado = 'CANCELADA', cancelado_por = 'CLIENTE', cancelado_at = :canceladoAt
          WHERE id = ANY(ARRAY[:bookingIds]::uuid[]) AND id <> :primaryBookingId`,
        { replacements: { bookingIds, primaryBookingId: booking.id, canceladoAt: booking.cancelado_at }, transaction: t }
      );

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
    if (error.code === 'BOOKING_GROUP_INVALID') {
      return res.status(409).json({ code: error.code, error: 'No pudimos validar todos los servicios vinculados a esta reserva.' });
    }
    if (error.code === 'BOOKING_GROUP_STATE_CONFLICT') {
      return res.status(409).json({ code: error.code, error: 'Uno de los servicios vinculados ya no se puede cancelar.' });
    }
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
    const newBookingDay = getColombiaDayRange(nuevaFecha);
    if (!newBookingDay) {
      return res.status(400).json({ error: 'La nueva fecha no es válida.' });
    }

    const rescheduled = await sequelize.transaction(async (transaction) => {
      await sequelize.query('SET LOCAL ROLE app_system', { transaction });
      const details = await sequelize.query(
        `SELECT b.provider_id, b.estado, b.reschedule_count, b.scheduled_at,
                b.productos_adicionales,
                COALESCE(s.duration_minutes, 60) AS duration_minutes
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
          WHERE b.id = :bookingId AND b.client_id = :clientId
          LIMIT 1`,
        { replacements: { bookingId, clientId }, type: sequelize.QueryTypes.SELECT, transaction }
      );
      if (!details.length) return { missing: true };
      const locked = details[0];
      const providerId = Number(details[0].provider_id);

      let bookingMetadata = locked.productos_adicionales || {};
      if (typeof bookingMetadata === 'string') {
        try { bookingMetadata = JSON.parse(bookingMetadata); } catch (_) { bookingMetadata = {}; }
      }
      const rawLinkedIds = Array.isArray(bookingMetadata.linked_booking_ids)
        ? bookingMetadata.linked_booking_ids.map(String)
        : [];
      if (rawLinkedIds.some((id) => !UUID_CITA.test(id))) return { groupInvalid: true };
      const linkedIds = rawLinkedIds;
      const bookingIds = [...new Set([String(bookingId), ...linkedIds])];
      const bookingGroup = await sequelize.query(
        `SELECT b.id, b.provider_id, b.client_id, b.estado, b.reschedule_count,
                b.scheduled_at, b.business_profile_id, b.salon_id, b.productos_adicionales,
                COALESCE(s.duration_minutes, 60) AS duration_minutes
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
          WHERE b.id = ANY(ARRAY[:bookingIds]::uuid[]) AND b.client_id = :clientId
          ORDER BY b.id
          FOR UPDATE OF b`,
        { replacements: { bookingIds, clientId }, type: sequelize.QueryTypes.SELECT, transaction }
      );
      if (bookingGroup.length !== bookingIds.length || bookingGroup.some((row) => Number(row.provider_id) !== providerId)) {
        return { groupInvalid: true };
      }
      const clickedBooking = bookingGroup.find((row) => String(row.id) === String(bookingId));
      if (!clickedBooking) return { missing: true };
      if (!['PENDIENTE_PAGO', 'CONFIRMADA'].includes(clickedBooking.estado)) return { stateConflict: clickedBooking.estado };
      if (Number(clickedBooking.reschedule_count) >= 1) return { limitReached: true };
      if (bookingGroup.some((row) => !['PENDIENTE_PAGO', 'CONFIRMADA'].includes(row.estado))) {
        return { stateConflict: bookingGroup.find((row) => !['PENDIENTE_PAGO', 'CONFIRMADA'].includes(row.estado)).estado };
      }
      if (bookingGroup.some((row) => Number(row.reschedule_count) >= 1)) return { limitReached: true };
      const firstBookingAt = new Date(bookingGroup[0].scheduled_at);
      const hoursBefore = (firstBookingAt.getTime() - Date.now()) / 3_600_000;
      if (hoursBefore < 24) return { cutoff: true, hoursBefore };
      if (new Set(bookingGroup.map((row) => String(row.business_profile_id || ''))).size > 1 ||
          new Set(bookingGroup.map((row) => String(row.salon_id || ''))).size > 1) {
        return { groupInvalid: true };
      }
      bookingGroup.sort((a, b) => {
        const metadataFor = (row) => {
          if (row.productos_adicionales && typeof row.productos_adicionales === 'object') return row.productos_adicionales;
          try { return JSON.parse(row.productos_adicionales || '{}'); } catch (_) { return {}; }
        };
        const aPosition = Number(metadataFor(a).group_position);
        const bPosition = Number(metadataFor(b).group_position);
        if (Number.isInteger(aPosition) && Number.isInteger(bPosition)) return aPosition - bPosition;
        return new Date(a.scheduled_at) - new Date(b.scheduled_at);
      });
      const totalDurationMinutes = bookingGroup.reduce((sum, row) => sum + Number(row.duration_minutes || 60), 0);

      const oldBookingDay = getColombiaDayRange(locked.scheduled_at);
      if (!oldBookingDay) return { groupInvalid: true };
      const lockDates = [...new Set([oldBookingDay.localDate, newBookingDay.localDate])].sort();
      for (const localDate of lockDates) {
        await sequelize.query(
          'SELECT pg_advisory_xact_lock(:providerId, hashtext(:localDate))',
          { replacements: { providerId, localDate }, transaction }
        );
      }
      const salonId = bookingGroup.find((row) => row.salon_id != null)?.salon_id ?? null;
      const providerHours = await sequelize.query(
        `SELECT p.active_start_hour, p.active_end_hour, p.weekly_schedule, s.horario_atencion
           FROM perfiles_prestador p
           LEFT JOIN salones s ON s.id = :salonId
          WHERE p.id = :providerId`,
        { replacements: { providerId, salonId }, type: sequelize.QueryTypes.SELECT, transaction }
      );
      const hours = providerHours[0] || {};
      const providerSchedule = getColombiaSchedule({
        date: newBookingDay.localDate,
        weeklySchedule: hours.weekly_schedule,
        activeStartHour: hours.active_start_hour,
        activeEndHour: hours.active_end_hour,
      });
      const schedule = intersectColombiaSchedules(providerSchedule, hours.horario_atencion, newBookingDay.localDate);
      if (!isWithinColombiaSchedule({
        scheduledAt: nuevaFecha,
        durationMinutes: totalDurationMinutes,
        schedule,
      })) return { invalidSchedule: true };

      const durationMs = totalDurationMinutes * 60_000;
      const candidateEnd = nuevaFecha.getTime() + durationMs;
      const dayBookings = await sequelize.query(
        `SELECT b.id, b.scheduled_at, COALESCE(s.duration_minutes, 60) AS duration_minutes
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
          WHERE b.provider_id = :providerId AND b.id <> ALL(ARRAY[:bookingIds]::uuid[])
            AND b.estado::text NOT IN ('CANCELADA', 'CANCELLED')
            AND b.scheduled_at >= :dayStart AND b.scheduled_at < :dayEnd`,
        { replacements: { providerId, bookingIds, dayStart: newBookingDay.start, dayEnd: newBookingDay.endExclusive }, type: sequelize.QueryTypes.SELECT, transaction }
      );
      const collision = dayBookings.some((other) => {
        const otherStart = new Date(other.scheduled_at).getTime();
        const otherEnd = otherStart + Number(other.duration_minutes || 60) * 60_000;
        return nuevaFecha.getTime() < otherEnd && candidateEnd > otherStart;
      });
      if (collision) return { conflict: true };
      let nextScheduledAt = new Date(nuevaFecha);
      for (const row of bookingGroup) {
        await sequelize.query(
          `UPDATE bookings SET scheduled_at = :scheduledAt, reschedule_count = :rescheduleCount
            WHERE id = :bookingId AND client_id = :clientId`,
          {
            replacements: {
              scheduledAt: nextScheduledAt,
              rescheduleCount: Number(row.reschedule_count || 0) + 1,
              bookingId: row.id,
              clientId,
            },
            transaction,
          }
        );
        nextScheduledAt = new Date(nextScheduledAt.getTime() + Number(row.duration_minutes || 60) * 60_000);
      }
      return { success: true, bookingIds };
    });
    if (rescheduled.missing) {
      return res.status(404).json({ error: 'Cita no encontrada o sin permisos para reprogramarla.' });
    }
    if (rescheduled.groupInvalid) {
      return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar todos los servicios vinculados a esta reserva. Contacta a soporte.' });
    }
    if (rescheduled.stateConflict) {
      return res.status(409).json({ error: `No se puede reprogramar una cita en estado ${rescheduled.stateConflict}.`, accion: 'CANCELAR' });
    }
    if (rescheduled.limitReached) {
      return res.status(409).json({ error: 'Ya usaste tu reprogramación gratuita. Una segunda reprogramación cuenta como cancelación.', accion: 'CANCELAR', reprogramaciones_usadas: 1 });
    }
    if (rescheduled.cutoff) {
      return res.status(409).json({ error: 'La reprogramación gratuita se cierra 24 horas antes del servicio.', accion: 'CANCELAR', horas_anticipacion: Number(Math.max(0, rescheduled.hoursBefore).toFixed(1)) });
    }
    if (rescheduled.conflict) {
      return res.status(409).json({ code: 'BOOKING_SLOT_TAKEN', error: 'El horario seleccionado ya está reservado o entra en conflicto con otra cita.' });
    }
    if (rescheduled.invalidSchedule) {
      return res.status(409).json({ code: 'BOOKING_SLOT_INVALID', error: 'El nuevo horario no coincide con la jornada y los intervalos disponibles del prestador.' });
    }
    booking.scheduled_at = nuevaFecha;
    booking.reschedule_count = veces + 1;

    res.json({
      success: true,
      message: 'Cita reprogramada. Esta fue tu reprogramación gratuita.',
      booking: {
        id: booking.id,
        scheduled_at: booking.scheduled_at,
        reschedule_count: booking.reschedule_count,
        booking_ids: rescheduled.bookingIds
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
  const bookingId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_system');

    if (!(await canManageBooking(req, bookingId, client, ACTIONS.UPDATE))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cita no encontrada o sin permisos para cancelarla.' });
    }
    const { rows } = await client.query(
      `SELECT id, provider_id, client_id, estado, scheduled_at, payment_status, valor_bruto,
              business_profile_id, salon_id, productos_adicionales
         FROM bookings WHERE id = $1`,
      [bookingId]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cita no encontrada o sin permisos para cancelarla.' });
    }
    let booking = rows[0];
    let metadata = booking.productos_adicionales || {};
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; }
    }
    const rawLinkedIds = Array.isArray(metadata.linked_booking_ids)
      ? metadata.linked_booking_ids.map(String)
      : [];
    if (rawLinkedIds.some((id) => !UUID_CITA.test(id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar todos los servicios vinculados a esta reserva.' });
    }
    const bookingIds = [...new Set([String(booking.id), ...rawLinkedIds])];
    const primaryBookingId = metadata.primary_booking_id && UUID_CITA.test(String(metadata.primary_booking_id))
      ? String(metadata.primary_booking_id)
      : String(booking.id);
    const group = await client.query(
      `SELECT id, provider_id, client_id, estado, scheduled_at, payment_status,
              valor_bruto, business_profile_id, salon_id
         FROM bookings
        WHERE id = ANY($1::uuid[])
        ORDER BY id FOR UPDATE`,
      [bookingIds]
    );
    if (group.rows.length !== bookingIds.length || group.rows.some((row) =>
      Number(row.provider_id) !== Number(booking.provider_id) ||
      String(row.client_id) !== String(booking.client_id) ||
      String(row.business_profile_id || '') !== String(booking.business_profile_id || '') ||
      String(row.salon_id || '') !== String(booking.salon_id || ''))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar todos los servicios vinculados a esta reserva.' });
    }
    const invalidGroupState = group.rows.find((row) => ['CANCELADA', 'COMPLETADA'].includes(row.estado));
    if (invalidGroupState) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: invalidGroupState.estado === 'CANCELADA' ? 'La cita ya está cancelada' : 'No se puede cancelar una cita completada' });
    }
    booking = group.rows.find((row) => String(row.id) === primaryBookingId);
    if (!booking) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'BOOKING_GROUP_INVALID', error: 'No pudimos validar el servicio principal de esta reserva.' });
    }
    const invalidState = group.rows.find((row) => ['CANCELADA', 'COMPLETADA'].includes(row.estado));
    if (invalidState) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: invalidState.estado === 'CANCELADA' ? 'La cita ya está cancelada' : 'No se puede cancelar una cita completada' });
    }

    const firstBookingAt = group.rows.reduce((earliest, row) =>
      new Date(row.scheduled_at) < new Date(earliest) ? row.scheduled_at : earliest,
    group.rows[0].scheduled_at);
    const horasAntes = (new Date(firstBookingAt).getTime() - Date.now()) / (60 * 60 * 1000);
    const tardia = horasAntes < 24;

    const updated = await client.query(
      `UPDATE bookings SET estado = 'CANCELADA', cancelado_por = 'PRESTADOR', cancelado_at = NOW()
        WHERE id = ANY($1::uuid[]) RETURNING id, estado`,
      [bookingIds]
    );

    // Devolución íntegra al cliente: la falta es del prestador.
    if (booking.payment_status === 'paid') {
      await client.query(
        `INSERT INTO reembolsos
           (booking_id, client_id, monto, porcentaje_devolucion, tramo, motivo, estado)
         VALUES ($1, $2, $3, 100, 'CANCELA_PRESTADOR', $4, 'PENDIENTE')`,
        [primaryBookingId, booking.client_id, Number(booking.valor_bruto) || 0,
          `Cancelación del prestador con ${Math.max(0, horasAntes).toFixed(1)} h de anticipación`]
      );
    }

    let suspendido = false;
    let cancelaciones90d = 0;

    if (tardia) {
      const countResult = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(productos_adicionales->>'primary_booking_id', id::text))::int AS total
           FROM bookings
          WHERE provider_id = $1
            AND cancelado_por = 'PRESTADOR'
            AND cancelado_at > NOW() - INTERVAL '90 days'`,
        [booking.provider_id]
      );
      cancelaciones90d = countResult.rows[0]?.total || 0;

      await client.query(
        `UPDATE perfiles_prestador
            SET cancelaciones_tardias = cancelaciones_tardias + 1
          WHERE id = $1`,
        [booking.provider_id]
      );

      if (cancelaciones90d >= 3) {
        suspendido = true;
        await client.query(
          `INSERT INTO provider_wallet (provider_id, retiros_pausados)
           VALUES ($1, TRUE)
           ON CONFLICT (provider_id) DO UPDATE SET retiros_pausados = TRUE, updated_at = NOW()`,
          [booking.provider_id]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: tardia
        ? 'Cita cancelada. Por cancelar con menos de 24 h se registró en tu historial.'
        : 'Cita cancelada sin sanción.',
      booking: { id: booking.id, status: updated.rows[0].estado, booking_ids: bookingIds },
      cancelacion: {
        horas_anticipacion: Number(Math.max(0, horasAntes).toFixed(1)),
        tardia,
        cancelaciones_90d: cancelaciones90d,
        retiros_suspendidos: suspendido,
        devolucion_cliente: booking.payment_status === 'paid' ? Number(booking.valor_bruto) || 0 : 0
      }
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* la transacción pudo cerrarse */ }
    console.error('❌ ERROR EN PATCH /api/bookings/:id/cancel-provider:', error.message);
    res.status(500).json({ error: 'Error interno al cancelar la cita' });
  } finally {
    client.release();
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

        // 🔹 Enviar correo de confirmación (fuera de la transacción, best-effort)
        // Idempotencia: el webhook ya regresó temprano si existingTx.status === 'paid'
        try {
                  const emailService = require('../services/emailService');
                  // Volver a leer la cita con relaciones para obtener email del cliente y nombre del prestador
                  const bookingCompleta = await Booking.findByPk(bookingId, {
                    include: [
                      { model: require('../models').User, as: 'client', attributes: ['email', 'nombre'] },
                      { model: require('../models').User, as: 'provider', attributes: ['nombre'] },
                      { model: require('../models').Service, as: 'service', attributes: ['name'] },
                    ],
                  });
                  if (bookingCompleta?.client?.email) {
                    const fechaFormateada = bookingCompleta.scheduled_at
                      ? new Date(bookingCompleta.scheduled_at).toLocaleString('es-CO', {
                          dateStyle: 'long',
                          timeStyle: 'short',
                          timeZone: 'America/Bogota',
                        })
                      : '—';
                    const refCorta = String(bookingId).slice(0, 8).toUpperCase();
                    const result = await emailService.sendBookingConfirmationEmail({
                      toEmail: bookingCompleta.client.email,
                      clientName: bookingCompleta.client.nombre || 'Cliente',
                      bookingId,
                      serviceName: bookingCompleta.service?.name || bookingCompleta.service_name || 'Servicio',
                      providerName: bookingCompleta.provider?.nombre || 'Prestador',
                      appointmentDate: fechaFormateada,
                      paymentMethod,
                      amount: '$' + Number(amount).toLocaleString('es-CO', { maximumFractionDigits: 0 }),
                      reference: refCorta,
                    });
                    console.log(`📧 [WOMPI WEBHOOK] Correo de confirmación enviado (booking_id=${bookingId}, messageId=${result?.messageId || 'dev'})`);
                  } else {
                    console.warn(`[WOMPI WEBHOOK] No se pudo enviar confirmación: cliente sin email en cita ${bookingId}`);
                  }
                } catch (emailErr) {
                  console.error(`[WOMPI WEBHOOK] Error enviando correo de confirmación (no bloquea):`, emailErr.message);
                }
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
// Aspectos que el cliente puede marcar junto a las estrellas. Es una lista
// cerrada: el texto libre no se puede filtrar ni agregar, los aspectos sí.
const ASPECTOS_RESENIA = ['Puntualidad', 'Resultado', 'Trato', 'Higiene', 'Precio-calidad'];

exports.createReview = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const clientId = req.user.id;
    const { rating, comment, aspectos } = req.body;

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

    // Elegibilidad: basta con que el servicio haya ocurrido. Exigir COMPLETADA
    // ataba la reseña a que el prestador cerrara la cita; cuando no lo hacía, el
    // cliente no podía opinar nunca y el catálogo se quedaba sin prueba social.
    const estadoActual = String(booking.estado || '').toUpperCase();
    if (estadoActual === 'CANCELADA' || estadoActual === 'CANCELLED') {
      return res.status(400).json({ error: 'Una cita cancelada no se puede calificar' });
    }

    const fechaCita = booking.scheduled_at ? new Date(booking.scheduled_at) : null;
    const yaOcurrio = estadoActual === 'COMPLETADA'
      || estadoActual === 'COMPLETED'
      || (fechaCita !== null && fechaCita.getTime() < Date.now());
    if (!yaOcurrio) {
      return res.status(400).json({ error: 'Solo puedes calificar una cita que ya ocurrió' });
    }

    const reviewCheck = await pool.query('SELECT id FROM reviews WHERE booking_id = $1', [bookingId]);
    if (reviewCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Esta cita ya ha sido calificada' });
    }

    const aspectosLimpios = Array.isArray(aspectos)
      ? [...new Set(aspectos.filter((a) => ASPECTOS_RESENIA.includes(a)))].slice(0, ASPECTOS_RESENIA.length)
      : [];

    const clientDb = await pool.connect();
    try {
      await clientDb.query('BEGIN');

      // El prestador suele estar en otro inquilino: con el contexto del cliente,
      // la actualización de su reputación afectaba 0 filas y el promedio nunca
      // se movía.
      await clientDb.query('SET LOCAL ROLE app_system');

      const insertReviewQuery = `
        INSERT INTO reviews (booking_id, client_id, provider_id, rating, comment, aspectos)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING id;
      `;
      await clientDb.query(insertReviewQuery, [
        bookingId,
        clientId,
        booking.provider_id,
        parsedRating,
        comment || null,
        JSON.stringify(aspectosLimpios)
      ]);

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

    if (!(await canManageBooking(req, bookingId, null, ACTIONS.CONFIRM_BOOKING))) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para iniciarla' });
    }
    const booking = await runAsSystemContext(() => Booking.findByPk(bookingId));

    if (!booking) {
      return res.status(404).json({ error: 'Cita no encontrada o no tienes permisos para iniciarla' });
    }

    if (!['CONFIRMADA', 'CHECKIN_REALIZADO'].includes(booking.estado)) {
      return res.status(400).json({ error: `No se puede iniciar el servicio. El estado actual es ${booking.estado} (debe ser CONFIRMADA o CHECKIN_REALIZADO).` });
    }

    booking.estado = 'EN_PROGRESO';
    // Fallback para flujos que no pasan por el check-in GPS: registra el
    // evento real de inicio. Si hubo check-in antes, conserva su hora.
    booking.checkin_at = booking.checkin_at || new Date();
    await runAsSystemContext(() => booking.save());

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

// ── Enlace de descarga del recibo (ítem 31) ─────────────────────────────────
//
// El recibo se sirve con un enlace firmado de 10 minutos. La alternativa —pasar
// el JWT de sesión por query string— deja el token del usuario en el historial
// del navegador y en los logs del proxy, que es peor que no tener descarga.
function firmarEnlaceRecibo(bookingId, userId) {
  return jwt.sign(
    { bid: String(bookingId), uid: userId, scope: 'receipt' },
    getJwtSecret(),
    { expiresIn: '10m' },
  );
}

module.exports.createReceiptLink = async (req, res) => {
  try {
    const fila = await cargarReservaParaRecibo(req.params.id, req.user.id);
    if (!fila) {
      return res.status(404).json({ error: 'Cita no encontrada o no te pertenece' });
    }
    const t = firmarEnlaceRecibo(fila.id, req.user.id);
    const base = `${req.protocol}://${req.get('host')}`;
    return res.json({
      success: true,
      url: `${base}/api/bookings/${fila.id}/receipt/download?t=${encodeURIComponent(t)}`,
      expira_en_segundos: 600,
    });
  } catch (error) {
    console.error('❌ ERROR EN /api/bookings/:id/receipt/link:', error.message);
    return res.status(500).json({ error: 'No pudimos preparar la descarga del recibo' });
  }
};

module.exports.downloadReceipt = async (req, res) => {
  try {
    const { t } = req.query;
    if (!t) return res.status(401).json({ error: 'Falta el enlace del recibo' });
    let payload;
    try {
      payload = jwt.verify(String(t), getJwtSecret());
    } catch (e) {
      return res.status(401).json({ error: 'El enlace del recibo venció. Vuelve a generarlo.' });
    }
    if (payload.scope !== 'receipt' || String(payload.bid) !== String(req.params.id)) {
      return res.status(403).json({ error: 'Este enlace no corresponde a esa cita' });
    }
    const fila = await cargarReservaParaRecibo(req.params.id, payload.uid);
    if (!fila) return res.status(404).json({ error: 'Cita no encontrada' });

    const { html } = reciboDesdeFila(fila, req.query.metodo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="recibo-${String(fila.id).slice(0, 8)}.html"`);
    return res.send(html);
  } catch (error) {
    console.error('❌ ERROR EN /bookings/:id/receipt/download:', error.message);
    return res.status(500).json({ error: 'No pudimos generar el recibo' });
  }
};
