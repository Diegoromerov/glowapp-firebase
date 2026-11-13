/**
 * 100 XP al crear la cuenta: una sola vez por persona, y por el punto único.
 *
 * El XP no cuesta dinero, pero duplicarlo miente en la barra del club. La
 * idempotencia vive en la consulta previa; la escritura, en `xpService`, que es
 * quien sabe si con esos XP cambia de nivel y hay que avisar.
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/xpService', () => ({ acreditarXp: jest.fn().mockResolvedValue({}) }));

const { pool } = require('../src/config/db');
const xpService = require('../src/services/xpService');
const { acreditarXpBienvenida, XP_BIENVENIDA } = require('../src/services/xpBienvenidaService');

beforeEach(() => jest.clearAllMocks());

test('acredita 100 XP por el punto único, con su motivo', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no hay bienvenida previa
  const r = await acreditarXpBienvenida({ userId: 7 });

  expect(r).toEqual({ acreditado: true, puntos: 100 });
  expect(xpService.acreditarXp).toHaveBeenCalledWith({
    userId: 7,
    xp: XP_BIENVENIDA,
    motivo: 'registro:bienvenida',
    cliente: pool,
  });
});

test('si ya tenía su bienvenida, no escribe ni avisa', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
  const r = await acreditarXpBienvenida({ userId: 7 });

  expect(r.acreditado).toBe(false);
  expect(xpService.acreditarXp).not.toHaveBeenCalled();
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
