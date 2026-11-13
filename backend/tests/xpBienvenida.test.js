/**
 * 100 XP al crear la cuenta: una sola vez por persona.
 *
 * El XP no cuesta dinero, pero duplicarlo sí miente en la barra del club. La
 * idempotencia va en la consulta (xp_logs no tiene clave única).
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/db');
const { acreditarXpBienvenida, XP_BIENVENIDA } = require('../src/services/xpBienvenidaService');

beforeEach(() => jest.clearAllMocks());

test('acredita 100 XP con motivo propio', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9 }] });
  const r = await acreditarXpBienvenida({ userId: 7 });
  expect(r).toEqual({ acreditado: true, puntos: 100 });
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain('INSERT INTO xp_logs');
  expect(sql).toContain('NOT EXISTS');
  expect(params).toEqual([7, XP_BIENVENIDA, 'registro:bienvenida']);
});

test('si ya existía el asiento, no duplica', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  const r = await acreditarXpBienvenida({ userId: 7 });
  expect(r.acreditado).toBe(false);
});

test('sin usuario no consulta nada', async () => {
  const r = await acreditarXpBienvenida({});
  expect(r.acreditado).toBe(false);
  expect(pool.query).not.toHaveBeenCalled();
});

test('un error de base no rompe el registro', async () => {
  pool.query.mockRejectedValueOnce(new Error('boom'));
  const r = await acreditarXpBienvenida({ userId: 7 });
  expect(r).toEqual({ acreditado: false, motivo: 'ERROR' });
});
