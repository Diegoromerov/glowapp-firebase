const { pool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const { AuthorizationService, RESOURCES, ACTIONS } = require('../services/authorizationService');

function getActiveBookingSalonId(req) {
  const raw = req.headers?.['x-active-salon-id'] ?? req.query?.salon_id;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : NaN;
}

/**
 * Autoriza al prestador titular o a una membresía operativa activa del negocio.
 * Si la cita pertenece a una sede, el actor debe tener esa sede seleccionada.
 * Puede recibir el cliente transaccional de PostgreSQL para volver a comprobar
 * el permiso dentro de la misma transacción que efectúa la operación.
 */
async function canManageBooking(req, bookingId, transactionClient = null, action = ACTIONS.UPDATE) {
  const salonId = getActiveBookingSalonId(req);
  if (Number.isNaN(salonId)) return false;

  const query = `SELECT
       EXISTS (
       SELECT 1 FROM bookings b
        WHERE b.id = $1
          AND b.provider_id = $2
          AND (b.business_profile_id IS NULL OR EXISTS (
            SELECT 1 FROM business_profiles bp
             WHERE bp.id = b.business_profile_id AND bp.provider_id = $2
          ))
          AND (
            ($3::integer IS NULL AND b.salon_id IS NULL)
            OR ($3::integer IS NOT NULL AND b.salon_id = $3 AND EXISTS (
              SELECT 1 FROM salones s
               WHERE s.id = $3
                 AND (
                   (b.business_profile_id IS NULL AND s.business_profile_id IS NULL AND s.id_dueno = $2)
                   OR (s.business_profile_id = b.business_profile_id AND EXISTS (
                     SELECT 1 FROM business_profiles bp
                      WHERE bp.id = s.business_profile_id AND bp.provider_id = $2
                   ))
                 )
            ))
          )
       ) AS owner_allowed,
       (
         SELECT m.role
           FROM bookings b
           JOIN memberships m ON m.business_profile_id = b.business_profile_id
          WHERE b.id = $1
            AND b.business_profile_id IS NOT NULL
            AND m.user_id = $2
            AND m.status = 'ACTIVE'
            AND (($3::integer IS NULL AND b.salon_id IS NULL) OR EXISTS (
              SELECT 1 FROM salones s
               WHERE s.id = $3 AND s.business_profile_id = b.business_profile_id
                 AND (b.salon_id IS NULL OR b.salon_id = s.id)
            ))
            AND (b.salon_id IS NULL OR EXISTS (
              SELECT 1 FROM salones s
               WHERE s.id = b.salon_id AND s.business_profile_id = b.business_profile_id
            ))
          LIMIT 1
       ) AS membership_role`;
  const values = [bookingId, req.user.id, salonId];
  const result = transactionClient
    ? await transactionClient.query(query, values)
    : await runAsSystem({ pool }, (client) => client.query(query, values));
  const row = result.rows[0];
  if (row?.owner_allowed === true) return true;
  return AuthorizationService.can(row?.membership_role, RESOURCES.BOOKING, action);
}

module.exports = { getActiveBookingSalonId, canManageBooking };
