/**
 * GET /api/auth/referral-info: la columna que consulta tiene que existir.
 *
 * El endpoint devolvía 500 en producción con `column "referral_code" does not
 * exist` y la pantalla de invitar quedaba inservible. La 139 creó el atributo
 * pero nunca el código.
 *
 * Este test no valida el esquema contra una base real (eso lo hace la cadena de
 * migraciones), pero sí fija dos cosas que se rompen fácil: que el controlador
 * consulta la columna por su nombre y que, si viene nula, la genera y la guarda
 * antes de responder.
 */
jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../src/config/db');
const authController = require('../src/controllers/authController');

const req = { user: { id: 7, email: 'a@b.co', role: 'client' }, headers: {} };
const mkRes = () => {
  const r = { body: null, code: 200 };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

beforeEach(() => jest.clearAllMocks());

test('consulta la columna referral_code', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 7, nombre: 'Ana', email: 'a@b.co', referral_code: 'GLOWABC123' }] })
    .mockResolvedValueOnce({ rows: [{ n: 0 }] })
    .mockResolvedValueOnce({ rows: [{ total: '0' }] });

  await authController.getReferralInfo(req, mkRes());
  const sql = pool.query.mock.calls[0][0];
  expect(sql).toContain('referral_code');
  expect(sql).toContain('usuarios');
});

test('si la cuenta aún no tiene código, lo genera y lo guarda antes de responder', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 7, nombre: 'Ana', email: 'a@b.co', referral_code: null }] })
    .mockResolvedValueOnce({ rows: [] })          // UPDATE del código
    .mockResolvedValueOnce({ rows: [{ n: 0 }] })
    .mockResolvedValueOnce({ rows: [{ total: '0' }] });

  const res = mkRes();
  await authController.getReferralInfo(req, res);

  const update = pool.query.mock.calls.find((c) => /UPDATE usuarios SET referral_code/i.test(c[0]));
  expect(update).toBeDefined();
  expect(String(update[1][0])).toMatch(/^[A-Z0-9]{6,}$/);
});
