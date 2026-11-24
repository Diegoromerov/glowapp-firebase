const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');

const MAX_POINTS = 1000000;
const MAX_NAME_LENGTH = 100;

function fail(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function integer(value, name, { min = 0, max = MAX_POINTS } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw fail(400, `${name} debe ser un entero entre ${min} y ${max}.`, 'INVALID_VALUE');
  }
  return number;
}

function computeAward({ pointsPerCompletedBooking, pointsPer1000Cop, grossCop }) {
  const value = Number(grossCop);
  if (!Number.isFinite(value) || value < 0) throw fail(409, 'El valor de la reserva no es válido.', 'INVALID_BOOKING_VALUE');
  const points = Number(pointsPerCompletedBooking || 0)
    + Math.floor(value / 1000) * Number(pointsPer1000Cop || 0);
  if (!Number.isSafeInteger(points) || points < 0 || points > MAX_POINTS) {
    throw fail(409, 'La regla configurada produce una cantidad de puntos no válida.', 'INVALID_AWARD');
  }
  return points;
}

async function systemTransaction(fn) {
  return runAsSystem({ pool, systemPool }, fn);
}

async function assertSalonScope(client, businessProfileId, salonId) {
  const { rows } = await client.query(
    `SELECT id FROM salones WHERE id = $1 AND business_profile_id = $2`,
    [salonId, businessProfileId]
  );
  if (!rows.length) throw fail(404, 'La sede no pertenece al negocio activo.', 'SALON_SCOPE_NOT_FOUND');
}

async function getProgram({ businessProfileId, salonId }) {
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT business_profile_id, salon_id, points_per_completed_booking,
              points_per_1000_cop, is_enabled, updated_at
         FROM salon_loyalty_programs WHERE business_profile_id = $1 AND salon_id = $2`,
      [businessProfileId, salonId]
    );
    return rows[0] || {
      business_profile_id: businessProfileId,
      salon_id: salonId,
      points_per_completed_booking: 0,
      points_per_1000_cop: 0,
      is_enabled: false,
      configured: false,
    };
  });
}

async function listProgramAudit({ businessProfileId, salonId }) {
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT points_per_completed_booking, points_per_1000_cop, is_enabled,
              changed_by, changed_at
         FROM salon_loyalty_program_audit
        WHERE business_profile_id = $1 AND salon_id = $2
        ORDER BY changed_at DESC, id DESC LIMIT 50`,
      [businessProfileId, salonId]
    );
    return rows;
  });
}

async function saveProgram({ businessProfileId, salonId, actorId, input }) {
  const perBooking = integer(input.pointsPerCompletedBooking ?? 0, 'pointsPerCompletedBooking');
  const perThousand = integer(input.pointsPer1000Cop ?? 0, 'pointsPer1000Cop');
  if (typeof input.isEnabled !== 'boolean') throw fail(400, 'isEnabled debe ser booleano.', 'INVALID_ACTIVE_STATE');
  const enabled = input.isEnabled === true;
  if (enabled && perBooking === 0 && perThousand === 0) {
    throw fail(400, 'Configura al menos una regla de acumulación para activar el programa.', 'EARNING_RULE_REQUIRED');
  }
  return systemTransaction(async (client) => {
    try {
      await assertSalonScope(client, businessProfileId, salonId);
      const { rows } = await client.query(
        `INSERT INTO salon_loyalty_programs
          (business_profile_id, salon_id, points_per_completed_booking, points_per_1000_cop,
           is_enabled, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (business_profile_id, salon_id) DO UPDATE SET
           points_per_completed_booking = EXCLUDED.points_per_completed_booking,
           points_per_1000_cop = EXCLUDED.points_per_1000_cop,
           is_enabled = EXCLUDED.is_enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING business_profile_id, salon_id, points_per_completed_booking,
                   points_per_1000_cop, is_enabled, updated_at`,
        [businessProfileId, salonId, perBooking, perThousand, enabled, actorId]
      );
      return rows[0];
    } catch (error) {
      throw error;
    }
  });
}

async function listRewards({ businessProfileId, salonId, includeInactive = false }) {
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT id, name, description, points_cost, is_active, max_redemptions_per_customer, created_at, updated_at
         FROM salon_loyalty_rewards WHERE business_profile_id = $1 AND salon_id = $2
          AND ($3::boolean OR is_active) ORDER BY created_at DESC`,
      [businessProfileId, salonId, includeInactive]
    );
    return rows;
  });
}

async function listRewardAudit({ businessProfileId, salonId }) {
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT reward_id, action, name, points_cost, is_active, changed_by, changed_at
         FROM salon_loyalty_reward_audit WHERE business_profile_id = $1 AND salon_id = $2
        ORDER BY changed_at DESC, id DESC LIMIT 50`,
      [businessProfileId, salonId]
    );
    return rows;
  });
}

function rewardInput(input, partial = false) {
  const value = {};
  if (!partial || Object.hasOwn(input, 'name')) {
    const name = String(input.name || '').trim();
    if (!name || name.length > MAX_NAME_LENGTH) throw fail(400, `El nombre debe tener entre 1 y ${MAX_NAME_LENGTH} caracteres.`, 'INVALID_REWARD_NAME');
    value.name = name;
  }
  if (!partial || Object.hasOwn(input, 'description')) {
    const desc = input.description == null ? null : String(input.description).trim();
    if (desc && desc.length > 500) throw fail(400, 'La descripción no puede superar 500 caracteres.', 'INVALID_REWARD_DESCRIPTION');
    value.description = desc || null;
  }
  if (!partial || Object.hasOwn(input, 'pointsCost')) value.pointsCost = integer(input.pointsCost, 'pointsCost', { min: 1 });
  if (Object.hasOwn(input, 'maxRedemptionsPerCustomer')) {
    value.maxRedemptions = input.maxRedemptionsPerCustomer == null
      ? null : integer(input.maxRedemptionsPerCustomer, 'maxRedemptionsPerCustomer', { min: 1, max: 100000 });
  } else if (!partial) value.maxRedemptions = null;
  if (Object.hasOwn(input, 'isActive')) {
    if (typeof input.isActive !== 'boolean') throw fail(400, 'isActive debe ser booleano.', 'INVALID_ACTIVE_STATE');
    value.isActive = input.isActive;
  } else if (!partial) value.isActive = true;
  return value;
}

async function createReward({ businessProfileId, salonId, actorId, input }) {
  const reward = rewardInput(input);
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `INSERT INTO salon_loyalty_rewards
        (business_profile_id, salon_id, name, description, points_cost,
         max_redemptions_per_customer, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING id, name, description, points_cost, is_active, max_redemptions_per_customer`,
      [businessProfileId, salonId, reward.name, reward.description, reward.pointsCost,
        reward.maxRedemptions, reward.isActive, actorId]
    );
    return rows[0];
  });
}

async function updateReward({ businessProfileId, salonId, rewardId, actorId, input }) {
  const reward = rewardInput(input, true);
  const columns = { name: 'name', description: 'description', pointsCost: 'points_cost',
    maxRedemptions: 'max_redemptions_per_customer', isActive: 'is_active' };
  const values = [businessProfileId, salonId, rewardId];
  const sets = [];
  for (const [key, column] of Object.entries(columns)) {
    if (Object.hasOwn(reward, key)) {
      values.push(reward[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) throw fail(400, 'Indica al menos un campo para actualizar.', 'EMPTY_UPDATE');
  values.push(actorId);
  sets.push(`updated_by = $${values.length}`, 'updated_at = NOW()');
  return systemTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE salon_loyalty_rewards SET ${sets.join(', ')}
        WHERE business_profile_id = $1 AND salon_id = $2 AND id = $3
        RETURNING id, name, description, points_cost, is_active, max_redemptions_per_customer`, values
    );
    if (!rows.length) throw fail(404, 'Recompensa no encontrada.', 'REWARD_NOT_FOUND');
    return rows[0];
  });
}

async function awardCompletedBooking({ businessProfileId, salonId, bookingId, actorId }) {
  return systemTransaction(async (client) => {
    try {
      const { rows: bookings } = await client.query(
        `SELECT id, client_id, business_profile_id, salon_id, estado::text AS status,
                payment_status, valor_bruto
           FROM bookings WHERE id = $1 AND business_profile_id = $2 AND salon_id = $3 FOR UPDATE`,
        [bookingId, businessProfileId, salonId]
      );
      const booking = bookings[0];
      if (!booking) throw fail(404, 'Reserva no encontrada en esta sede.', 'BOOKING_NOT_FOUND');
      if (booking.status !== 'COMPLETADA' || String(booking.payment_status).toLowerCase() !== 'paid') {
        throw fail(409, 'Los puntos se otorgan solo por una reserva completada y pagada.', 'BOOKING_NOT_ELIGIBLE');
      }
      const { rows: programs } = await client.query(
        `SELECT points_per_completed_booking, points_per_1000_cop, is_enabled FROM salon_loyalty_programs
          WHERE business_profile_id = $1 AND salon_id = $2 AND is_enabled = TRUE FOR SHARE`,
        [businessProfileId, salonId]
      );
      if (!programs.length) throw fail(409, 'El programa de fidelización de esta sede no está activo.', 'PROGRAM_DISABLED');
      const points = computeAward({
        pointsPerCompletedBooking: programs[0].points_per_completed_booking,
        pointsPer1000Cop: programs[0].points_per_1000_cop,
        grossCop: booking.valor_bruto,
      });
      if (points === 0) throw fail(409, 'Las reglas configuradas no asignan puntos a esta reserva.', 'NO_POINTS_EARNED');
      await client.query(
        `INSERT INTO salon_loyalty_accounts (business_profile_id, salon_id, customer_user_id)
         VALUES ($1,$2,$3) ON CONFLICT (business_profile_id, salon_id, customer_user_id) DO NOTHING`,
        [businessProfileId, salonId, booking.client_id]
      );
      const { rows: accounts } = await client.query(
        `SELECT id FROM salon_loyalty_accounts
          WHERE business_profile_id = $1 AND salon_id = $2 AND customer_user_id = $3 FOR UPDATE`,
        [businessProfileId, salonId, booking.client_id]
      );
      const { rows: movement } = await client.query(
        `INSERT INTO salon_loyalty_movements
          (account_id, business_profile_id, salon_id, type, points_delta, source_type, source_id,
           idempotency_key, note, created_by)
         VALUES ($1,$2,$3,'AWARD',$4,'BOOKING',$5,$6,'Reserva completada y pagada',$7)
         ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id`,
        [accounts[0].id, businessProfileId, salonId, points, booking.id, `booking:${booking.id}:award`, actorId]
      );
      return { awarded: Boolean(movement.length), points: movement.length ? points : 0 };
    } catch (error) {
      throw error;
    }
  });
}

async function listEligibleBookings({ businessProfileId, salonId }) {
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT b.id, b.scheduled_at, b.valor_bruto, u.nombre AS customer_name,
              EXISTS (
                SELECT 1 FROM salon_loyalty_accounts a
                JOIN salon_loyalty_movements lm ON lm.account_id = a.id
                 WHERE a.business_profile_id = b.business_profile_id AND a.salon_id = b.salon_id
                   AND a.customer_user_id = b.client_id AND lm.source_type = 'BOOKING'
                   AND lm.source_id = b.id::text AND lm.type = 'AWARD'
              ) AS points_awarded
         FROM bookings b
         LEFT JOIN usuarios u ON u.id = b.client_id
        WHERE b.business_profile_id = $1 AND b.salon_id = $2
          AND b.estado::text = 'COMPLETADA' AND LOWER(COALESCE(b.payment_status, '')) = 'paid'
          AND b.client_id IS NOT NULL
          AND COALESCE((b.productos_adicionales->>'is_primary')::boolean, true) = true
          AND COALESCE(b.productos_adicionales->>'primary_booking_id', b.id::text) = b.id::text
        ORDER BY b.scheduled_at DESC NULLS LAST, b.id DESC LIMIT 100`,
      [businessProfileId, salonId]
    );
    return rows;
  });
}

function idempotencyKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key)) throw fail(400, 'Envía una clave de idempotencia de 8 a 120 caracteres.', 'IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

async function customerSummary({ salonId, customerUserId }) {
  return systemTransaction(async (client) => {
    const { rows: salons } = await client.query(
      `SELECT id, business_profile_id FROM salones WHERE id = $1 AND business_profile_id IS NOT NULL`, [salonId]
    );
    if (!salons.length) throw fail(404, 'Sede no encontrada.', 'SALON_NOT_FOUND');
    const scope = salons[0];
    const { rows } = await client.query(
      `SELECT a.id AS account_id, COALESCE(SUM(m.points_delta), 0)::int AS balance
         FROM salon_loyalty_accounts a
         LEFT JOIN salon_loyalty_movements m ON m.account_id = a.id
        WHERE a.business_profile_id = $1 AND a.salon_id = $2 AND a.customer_user_id = $3
        GROUP BY a.id`, [scope.business_profile_id, salonId, customerUserId]
    );
    const account = rows[0];
    if (!account) return { salon_id: salonId, balance: 0, movements: [] };
    const { rows: movements } = await client.query(
      `SELECT type, points_delta, note, created_at FROM salon_loyalty_movements
        WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50`, [account.account_id]
    );
    const { rows: program } = await client.query(
      `SELECT is_enabled FROM salon_loyalty_programs WHERE business_profile_id = $1 AND salon_id = $2`,
      [scope.business_profile_id, salonId]
    );
    return { salon_id: salonId, enabled: Boolean(program[0]?.is_enabled), balance: Number(account.balance), movements };
  });
}

async function customerRewards({ salonId }) {
  return systemTransaction(async (client) => {
    const { rows: salons } = await client.query(
      `SELECT id, business_profile_id FROM salones WHERE id = $1 AND business_profile_id IS NOT NULL`, [salonId]
    );
    if (!salons.length) throw fail(404, 'Sede no encontrada.', 'SALON_NOT_FOUND');
    const scope = salons[0];
    const { rows: program } = await client.query(
      `SELECT is_enabled FROM salon_loyalty_programs WHERE business_profile_id = $1 AND salon_id = $2`,
      [scope.business_profile_id, salonId]
    );
    if (!program[0]?.is_enabled) return { salon_id: salonId, enabled: false, rewards: [] };
    const { rows: rewards } = await client.query(
      `SELECT id, name, description, points_cost, max_redemptions_per_customer
         FROM salon_loyalty_rewards WHERE business_profile_id = $1 AND salon_id = $2 AND is_active = TRUE
        ORDER BY points_cost ASC, name ASC`, [scope.business_profile_id, salonId]
    );
    return { salon_id: salonId, enabled: true, rewards };
  });
}

async function redeem({ salonId, customerUserId, rewardId, key }) {
  const dedupe = idempotencyKey(key);
  return systemTransaction(async (client) => {
    try {
      const { rows: salons } = await client.query(
        `SELECT id, business_profile_id FROM salones WHERE id = $1 AND business_profile_id IS NOT NULL`, [salonId]
      );
      if (!salons.length) throw fail(404, 'Sede no encontrada.', 'SALON_NOT_FOUND');
      const scope = salons[0];
      await client.query(
        `INSERT INTO salon_loyalty_accounts (business_profile_id, salon_id, customer_user_id)
         VALUES ($1,$2,$3) ON CONFLICT (business_profile_id, salon_id, customer_user_id) DO NOTHING`,
        [scope.business_profile_id, salonId, customerUserId]
      );
      const { rows: accounts } = await client.query(
        `SELECT id FROM salon_loyalty_accounts WHERE business_profile_id = $1 AND salon_id = $2
          AND customer_user_id = $3 FOR UPDATE`, [scope.business_profile_id, salonId, customerUserId]
      );
      const accountId = accounts[0].id;
      const { rows: previous } = await client.query(
        `SELECT id, reward_id, status, points_cost FROM salon_loyalty_redemptions WHERE account_id = $1 AND idempotency_key = $2`,
        [accountId, dedupe]
      );
      if (previous.length) {
        if (String(previous[0].reward_id) !== String(rewardId)) {
          throw fail(409, 'La clave de idempotencia ya se usó para otra recompensa.', 'IDEMPOTENCY_KEY_REUSED');
        }
        return { redemption: previous[0], alreadyProcessed: true };
      }
      const { rows: programs } = await client.query(
        `SELECT is_enabled FROM salon_loyalty_programs WHERE business_profile_id = $1 AND salon_id = $2 FOR SHARE`,
        [scope.business_profile_id, salonId]
      );
      if (!programs[0]?.is_enabled) throw fail(409, 'El programa de fidelización no está activo.', 'PROGRAM_DISABLED');
      const { rows: rewardRows } = await client.query(
        `SELECT id, points_cost, max_redemptions_per_customer FROM salon_loyalty_rewards
          WHERE id = $1 AND business_profile_id = $2 AND salon_id = $3 AND is_active = TRUE FOR UPDATE`,
        [rewardId, scope.business_profile_id, salonId]
      );
      if (!rewardRows.length) throw fail(404, 'Recompensa no disponible.', 'REWARD_NOT_FOUND');
      const reward = rewardRows[0];
      if (reward.max_redemptions_per_customer != null) {
        const { rows: counts } = await client.query(
          `SELECT COUNT(*)::int AS total FROM salon_loyalty_redemptions
            WHERE account_id = $1 AND reward_id = $2 AND status <> 'CANCELLED'`, [accountId, reward.id]
        );
        if (Number(counts[0].total) >= Number(reward.max_redemptions_per_customer)) {
          throw fail(409, 'Ya alcanzaste el límite de canjes de esta recompensa.', 'REDEMPTION_LIMIT_REACHED');
        }
      }
      const { rows: balanceRows } = await client.query(
        `SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM salon_loyalty_movements WHERE account_id = $1`, [accountId]
      );
      if (Number(balanceRows[0].balance) < Number(reward.points_cost)) {
        throw fail(409, 'No tienes puntos suficientes para esta recompensa.', 'INSUFFICIENT_POINTS');
      }
      const { rows: redemptionRows } = await client.query(
        `INSERT INTO salon_loyalty_redemptions
          (account_id, reward_id, business_profile_id, salon_id, points_cost, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, points_cost`,
        [accountId, reward.id, scope.business_profile_id, salonId, reward.points_cost, dedupe]
      );
      await client.query(
        `INSERT INTO salon_loyalty_movements
          (account_id, business_profile_id, salon_id, type, points_delta, source_type, source_id, idempotency_key, note)
         VALUES ($1,$2,$3,'REDEMPTION',$4,'REWARD_REDEMPTION',$5,$6,'Canje solicitado por el cliente')`,
        [accountId, scope.business_profile_id, salonId, -Number(reward.points_cost), redemptionRows[0].id,
          `redemption:${redemptionRows[0].id}:debit`]
      );
      return { redemption: redemptionRows[0], alreadyProcessed: false };
    } catch (error) {
      throw error;
    }
  });
}

async function listRedemptions({ businessProfileId, salonId, status = 'PENDING' }) {
  const valid = ['PENDING', 'FULFILLED', 'CANCELLED', 'ALL'];
  if (!valid.includes(status)) throw fail(400, 'Filtro de estado inválido.', 'INVALID_STATUS');
  return systemTransaction(async (client) => {
    await assertSalonScope(client, businessProfileId, salonId);
    const { rows } = await client.query(
      `SELECT r.id, r.reward_id, rw.name AS reward_name, r.points_cost, r.status,
              r.created_at, r.fulfilled_at, a.customer_user_id, u.nombre AS customer_name
         FROM salon_loyalty_redemptions r
         JOIN salon_loyalty_rewards rw ON rw.id = r.reward_id
         JOIN salon_loyalty_accounts a ON a.id = r.account_id
         JOIN usuarios u ON u.id = a.customer_user_id
        WHERE r.business_profile_id = $1 AND r.salon_id = $2 AND ($3 = 'ALL' OR r.status = $3)
        ORDER BY r.created_at DESC LIMIT 200`, [businessProfileId, salonId, status]
    );
    return rows;
  });
}

async function updateRedemption({ businessProfileId, salonId, redemptionId, actorId, status }) {
  if (!['FULFILLED', 'CANCELLED'].includes(status)) throw fail(400, 'El estado debe ser FULFILLED o CANCELLED.', 'INVALID_STATUS');
  return systemTransaction(async (client) => {
    try {
      const { rows } = await client.query(
        `SELECT r.*, a.customer_user_id FROM salon_loyalty_redemptions r
          JOIN salon_loyalty_accounts a ON a.id = r.account_id
         WHERE r.id = $1 AND r.business_profile_id = $2 AND r.salon_id = $3 FOR UPDATE OF r, a`,
        [redemptionId, businessProfileId, salonId]
      );
      const redemption = rows[0];
      if (!redemption) throw fail(404, 'Canje no encontrado.', 'REDEMPTION_NOT_FOUND');
      if (redemption.status === status) {
        return redemption;
      }
      if (redemption.status !== 'PENDING') throw fail(409, 'El canje ya no está pendiente.', 'REDEMPTION_FINAL');
      if (status === 'CANCELLED') {
        await client.query(
          `INSERT INTO salon_loyalty_movements
            (account_id, business_profile_id, salon_id, type, points_delta, source_type,
             source_id, idempotency_key, note, created_by)
           VALUES ($1,$2,$3,'REFUND',$4,'REWARD_REDEMPTION',$5,$6,'Reembolso por canje cancelado',$7)
           ON CONFLICT (account_id, idempotency_key) DO NOTHING`,
          [redemption.account_id, businessProfileId, salonId, redemption.points_cost, redemption.id,
            `redemption:${redemption.id}:refund`, actorId]
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE salon_loyalty_redemptions SET status = $1,
           fulfilled_by = CASE WHEN $1 = 'FULFILLED' THEN $2 ELSE fulfilled_by END,
           fulfilled_at = CASE WHEN $1 = 'FULFILLED' THEN NOW() ELSE fulfilled_at END,
           updated_at = NOW() WHERE id = $3 RETURNING id, status, points_cost, fulfilled_at`,
        [status, actorId, redemption.id]
      );
      return updated[0];
    } catch (error) {
      throw error;
    }
  });
}

module.exports = {
  computeAward, getProgram, listProgramAudit, saveProgram, listRewards, listRewardAudit, createReward, updateReward,
  awardCompletedBooking, listEligibleBookings, customerSummary, customerRewards, redeem, listRedemptions, updateRedemption,
};
