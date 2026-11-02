// backend/src/services/agents/chronosAgent.js
const { pool } = require('../../config/db');
const { ESTADO_COMPLETADO } = require('./bookingStateConstants');

/**
 * AGENTE CHRONOS: Especialista en Ciclo de Vida del Tratamiento, Hábitos y Re-Booking Proactivo
 */
class ChronosAgent {
  // Cadencia por defecto por categoría de servicio en días
  TREATMENT_LIFECYCLE_DAYS = {
    'uñas': 21,
    'manicura': 21,
    'pedicura': 21,
    'cabello': 30,
    'corte': 30,
    'tinte': 30,
    'piel': 45,
    'limpieza facial': 45,
    'cejas': 21,
    'visajismo': 21
  };

  /**
   * Evalúa si un usuario tiene tratamientos que vencieron o requieren mantenimiento
   * @param {number|string} userId - ID del usuario
   * @returns {Promise<Object>} Análisis de tratamientos a re-agendar
   */
  async evaluateUserRebooking(userId) {
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
      return { status: 'error', message: 'userId inválido' };
    }

    const query = `
      SELECT b.id as booking_id, b.scheduled_at as booking_date, b.estado as status, s.name as service_name, s.tag_especialidad as category
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.client_id = $1 AND b.estado = $2
      ORDER BY b.scheduled_at DESC
      LIMIT 5;
    `;

    try {
      const res = await pool.query(query, [parsedUserId, ESTADO_COMPLETADO]);
      if (res.rows.length === 0) {
        return { status: 'no_history', message: 'El usuario no tiene reservas completadas previas.' };
      }

      const now = new Date();
      const pendingMaintenance = [];

      for (const booking of res.rows) {
        const bookingDate = new Date(booking.booking_date);
        const diffDays = Math.floor((now - bookingDate) / (1000 * 60 * 60 * 24));
        const categoryLower = (booking.category || '').toLowerCase();
        
        // Encontrar ciclo en días para esta categoría
        let cycleDays = 30; // por defecto 30 días
        for (const [key, days] of Object.entries(this.TREATMENT_LIFECYCLE_DAYS)) {
          if (categoryLower.includes(key) || booking.service_name.toLowerCase().includes(key)) {
            cycleDays = days;
            break;
          }
        }

        if (diffDays >= cycleDays) {
          pendingMaintenance.push({
            serviceName: booking.service_name,
            category: booking.category,
            daysSinceService: diffDays,
            recommendedCycleDays: cycleDays,
            urgency: diffDays > (cycleDays + 7) ? 'alta' : 'media'
          });
        }
      }

      return {
        status: 'success',
        userId: parsedUserId,
        hasPendingMaintenance: pendingMaintenance.length > 0,
        treatmentsDue: pendingMaintenance
      };
    } catch (err) {
      console.error('❌ [CHRONOS Agent] Error evaluando re-agendamiento:', err.message);
      return { status: 'error', message: err.message };
    }
  }

  /**
   * Evalúa la continuidad temporal de un Glow Cycle activo
   * @param {Object} cycle - Entidad GlowCycle
   * @returns {Object} Estado temporal, recordatorios pendientes e hitos
   */
  evaluateCycleContinuity(cycle) {
    if (!cycle || cycle.status !== 'active') {
      return {
        hasActiveContinuity: false,
        temporalState: cycle?.status === 'completed' ? 'GRADUATION_READY' : 'NO_CYCLE',
        message: 'No hay ciclo activo en curso.'
      };
    }

    const startDate = new Date(cycle.start_date || cycle.created_at || Date.now());
    const now = new Date();
    const currentDay = Math.max(1, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)) + 1);
    const durationDays = cycle.duration_days || 30;

    // Evaluar check-in de hoy
    const todayStr = now.toISOString().split('T')[0];
    const checkins = Array.isArray(cycle.checkin_history) ? cycle.checkin_history : [];
    const todayCheckin = checkins.find(c => c.date === todayStr);

    let temporalState = 'IN_PROGRESS_AM_PM';
    let actionRequired = 'today_routine_checkin';
    let reminderMessage = 'Recuerda completar los pasos de tu rutina AM/PM de hoy.';

    if (currentDay >= durationDays) {
      temporalState = 'DAY_30_FINAL_RESCAN';
      actionRequired = 'final_rescan_and_graduation';
      reminderMessage = '¡Día 30 alcanzado! Realiza tu re-escaneo final para graduar tu ciclo.';
    } else if (currentDay >= 15 && currentDay < 18) {
      temporalState = 'DAY_15_RESCAN_DUE';
      actionRequired = 'milestone_15d_rescan';
      reminderMessage = 'Hito del Día 15 listo: realiza tu re-escaneo para evaluar el avance y adaptar tu rutina.';
    } else if (currentDay === 1) {
      temporalState = 'DAY_1_BASELINE';
      actionRequired = 'initial_habits_start';
      reminderMessage = 'Primer día de tu Glow Cycle. Inicia con tu rutina matutina y nocturna.';
    }

    return {
      hasActiveContinuity: true,
      cycleId: cycle.id,
      currentDayNumber: currentDay,
      durationDays,
      temporalState,
      actionRequired,
      reminderMessage,
      isTodayCheckinCompleted: !!todayCheckin,
      nextMilestoneDay: currentDay < 15 ? 15 : (currentDay < durationDays ? durationDays : durationDays)
    };
  }
}

module.exports = new ChronosAgent();
