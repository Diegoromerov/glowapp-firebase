jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../../config/db');
const ownerController = require('../ownerController');

describe('owner dashboard tenant scope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aggregates only selected owned-salon bookings and assigns each to its actual salon', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [
        { provider_id: 10, salon_id: 1, nombre_prestador: 'Prestador compartido' },
        { provider_id: 10, salon_id: 2, nombre_prestador: 'Prestador compartido' },
      ] })
      .mockResolvedValueOnce({ rows: [{ provider_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ provider_id: 10, salon_id: 99 }] })
      // Include a foreign row deliberately: the controller's defense-in-depth
      // must keep it out even if the database/query boundary returns one.
      .mockResolvedValueOnce({ rows: [
        { id: 101, provider_id: 10, salon_id: 1, valor_bruto: 100, comision_plataforma: 10, impuestos_estado: 5, pago_neto_prestador: 85 },
        { id: 102, provider_id: 10, salon_id: 2, valor_bruto: 200, comision_plataforma: 20, impuestos_estado: 10, pago_neto_prestador: 170 },
        { id: 199, provider_id: 10, salon_id: 99, valor_bruto: 99000, comision_plataforma: 0, impuestos_estado: 0, pago_neto_prestador: 99000 },
      ] });

    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await ownerController.getDashboardMetrics({ ownedSalonIds: [1, 2], query: {} }, res);

    const bookingQuery = pool.query.mock.calls[3];
    expect(bookingQuery[0]).toContain('salon_id = ANY($1::int[])');
    expect(bookingQuery[1].slice(0, 2)).toEqual([[1, 2], [10]]);

    const metrics = res.json.mock.calls[0][0].metrics;
    expect(metrics).toMatchObject({ ingresos_brutos: 300, total_citas: 2 });
    expect(metrics.desglose_por_sede).toEqual([
      expect.objectContaining({ salon_id: 1, ingresos_brutos: 100, total_citas: 1, sedes_compartidas: true }),
      expect.objectContaining({ salon_id: 2, ingresos_brutos: 200, total_citas: 1, sedes_compartidas: true }),
    ]);
    expect(metrics.top_prestadores).toEqual([
      expect.objectContaining({ provider_id: 10, ingresos_generados: 300, total_citas: 2 }),
    ]);
    expect(metrics.advertencia).toContain('únicamente las citas de las sedes propias seleccionadas');
  });
});
