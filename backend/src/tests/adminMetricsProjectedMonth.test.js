const { buildProjections } = require('../services/adminMetricsService');

/**
 * ORDEN A-02 · RONDA 3 — «el mes que miente» (CI-18)
 *
 * `setMonth` sobre HOY salta un mes cuando hoy es 29, 30 o 31 (JavaScript normaliza: 31 de enero
 * + 1 mes = 3 de marzo). El importe proyectado es correcto; lo que miente es la etiqueta del mes
 * que el panel le enseña al admin.
 *
 * Estos casos recorren el SERVICIO (no miran el código como texto): importan `buildProjections`,
 * le inyectan `now` y afirman sobre lo que devuelve.
 */
const HISTORIAL_3_MESES = [
  { month: '2025-11', revenue: 1000 },
  { month: '2025-12', revenue: 1000 },
  { month: '2026-01', revenue: 1000 },
];

describe('buildProjections · mes proyectado (A-02 ronda 3)', () => {
  test('C1\'\' — hoy es 31 de enero ⇒ el mes proyectado es febrero, no marzo', () => {
    const r = buildProjections(HISTORIAL_3_MESES, new Date(2026, 0, 31));
    expect(r.projectedMonth).toBe('2026-02');
  });

  test('C1\'\' — hoy es 31 de marzo ⇒ abril, no mayo', () => {
    const r = buildProjections(HISTORIAL_3_MESES, new Date(2026, 2, 31));
    expect(r.projectedMonth).toBe('2026-04');
  });

  test('C2\'\' — hoy es 31 de diciembre ⇒ enero del año siguiente', () => {
    const r = buildProjections(HISTORIAL_3_MESES, new Date(2026, 11, 31));
    expect(r.projectedMonth).toBe('2027-01');
  });

  test('C4\'\' — el camino normal (hoy a mitad de mes) sigue igual', () => {
    const r = buildProjections(HISTORIAL_3_MESES, new Date(2026, 8, 15));
    expect(r.projectedMonth).toBe('2026-10');
    expect(r.data_status).toBe('completo');
    expect(r.meses_con_datos).toBe(3);
  });

  test('el importe proyectado NO cambia con esta corrección (sólo la etiqueta)', () => {
    const a = buildProjections(HISTORIAL_3_MESES, new Date(2026, 0, 31));
    const b = buildProjections(HISTORIAL_3_MESES, new Date(2026, 0, 15));
    expect(a.projectedRevenue).toBe(b.projectedRevenue);
    expect(a.trend).toBe(b.trend);
  });
});
