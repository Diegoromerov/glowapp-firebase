// backend/src/tests/provider_schedule.test.js
// Suite de pruebas para Horarios del Prestador (Gate 7)

describe('Provider Schedule & Allignment Suite', () => {

  describe('1. Validaciones de Horario Semanal', () => {
    const validarHorario = ({ activeStartHour, activeEndHour, weeklySchedule }) => {
      const start = activeStartHour !== undefined ? parseInt(activeStartHour) : 8;
      const end = activeEndHour !== undefined ? parseInt(activeEndHour) : 19;
      if (start < 0 || start > 23 || end < 0 || end > 23) {
        return { valid: false, error: 'Horas deben estar entre 0 y 23' };
      }
      if (start >= end) {
        return { valid: false, error: 'La hora de inicio debe ser menor a la hora de fin' };
      }
      return { valid: true, start, end };
    };

    test('Rechaza horas invalidas o rangos invertidos', () => {
      expect(validarHorario({ activeStartHour: 20, activeEndHour: 8 }).valid).toBe(false);
      expect(validarHorario({ activeStartHour: -5, activeEndHour: 18 }).valid).toBe(false);
    });

    test('Aprueba rango valido de horario', () => {
      const res = validarHorario({ activeStartHour: 8, activeEndHour: 19 });
      expect(res.valid).toBe(true);
      expect(res.start).toBe(8);
      expect(res.end).toBe(19);
    });
  });

  describe('2. Computo de Slots de Disponibilidad', () => {
    const generateSlots = (startHour, endHour, durationMinutes = 30) => {
      const slots = [];
      for (let h = startHour; h < endHour; h++) {
        slots.push(`${String(h).padStart(2, '0')}:00`);
        if (durationMinutes <= 30) {
          slots.push(`${String(h).padStart(2, '0')}:30`);
        }
      }
      return slots;
    };

    test('Genera intervalos correctos de 30 minutos', () => {
      const result = generateSlots(8, 10);
      expect(result).toEqual(['08:00', '08:30', '09:00', '09:30']);
    });
  });

});
