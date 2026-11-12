/**
 * GET /api/rewards/nivel — nivel y lecturas disponibles.
 *
 * La cuota cuelga del uso: reservas completadas + compras pagadas + bono de
 * nivel. El nivel solo no regala lecturas.
 */
jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../src/config/db');
const cuotasService = require('../src/services/cuotasService');

const fila = (o) => ({ rows: [{ reservas: 0, compras: 0, xp: 0, usados: 0, ...o }] });

beforeEach(() => jest.clearAllMocks());

test('una usuaria nueva tiene 1 lectura y nivel Glow', async () => {
  pool.query.mockResolvedValueOnce(fila({}));
  const r = await cuotasService.estadoDelMes({ userId: 1 });
  expect(r.nivel).toBe('Glow');
  expect(r.lecturas).toMatchObject({ otorgadas: 1, usadas: 0, disponibles: 1 });
});

test('el uso manda: 2 reservas y 1 compra suman 3 lecturas sobre la base gastada', async () => {
  pool.query.mockResolvedValueOnce(fila({ reservas: 2, compras: 1, usados: 1 }));
  const r = await cuotasService.estadoDelMes({ userId: 1 });
  expect(r.lecturas.otorgadas).toBe(3);
  expect(r.lecturas.disponibles).toBe(2);
  expect(r.hechos).toEqual({ reservas: 2, compras: 1 });
});

test('Diamante sin hechos recibe 6, no 25', async () => {
  pool.query.mockResolvedValueOnce(fila({ xp: 2500, usados: 1 }));
  const r = await cuotasService.estadoDelMes({ userId: 1 });
  expect(r.nivel).toBe('Diamante');
  expect(r.lecturas.otorgadas).toBe(6);
  expect(r.xp_siguiente_nivel).toBeNull();
});

test('consumo por encima de lo otorgado da 0, nunca negativo', async () => {
  pool.query.mockResolvedValueOnce(fila({ usados: 9 }));
  const r = await cuotasService.estadoDelMes({ userId: 1 });
  expect(r.lecturas.disponibles).toBe(0);
});

test('informa el costo de gastar todo en HD desde la tarifa real', async () => {
  pool.query.mockResolvedValueOnce(fila({ reservas: 2, usados: 0 }));
  const r = await cuotasService.estadoDelMes({ userId: 1 });
  expect(r.costos.lectura_hd_cop).toBe(1920);
  expect(r.costos.costo_si_usa_todo_hd).toBe(r.lecturas.disponibles * 1920);
});

test('la consulta cuenta reservas completadas, compras pagadas y consumo', async () => {
  pool.query.mockResolvedValueOnce(fila({}));
  await cuotasService.estadoDelMes({ userId: 7 });
  const sql = pool.query.mock.calls[0][0];
  expect(sql).toContain('COMPLETADA');
  expect(sql).toContain('PAGADO');
  expect(sql).toContain('ai_usage_events');
  expect(pool.query.mock.calls[0][1]).toEqual([7]);
});

test('registrarConsumo guarda el costo de una lectura HD e ignora duplicados', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });
  const r = await cuotasService.registrarConsumo({
    userId: 1, proveedor: 'youcam', lecturaTipo: 'HD', clave: 'analisis:1',
  });
  expect(r).toEqual({ registrado: true, costoCop: 1920 });
  expect(String(pool.query.mock.calls[0][0])).toContain('ON CONFLICT (clave) DO NOTHING');

  pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  const dup = await cuotasService.registrarConsumo({
    userId: 1, proveedor: 'youcam', lecturaTipo: 'HD', clave: 'analisis:1',
  });
  expect(dup.registrado).toBe(false);
});

test('registrarConsumo exige proveedor', async () => {
  await expect(cuotasService.registrarConsumo({ userId: 1 })).rejects.toThrow('proveedor');
});
