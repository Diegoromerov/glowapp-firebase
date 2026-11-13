/**
 * El enlace de invitación va SIN `#`.
 *
 * Firebase Hosting tiene `cleanUrls: true` y normaliza la URL a la raíz antes de
 * que el arranque de Flutter lea el fragmento: con `/#/register?ref=` la
 * invitada aterrizaba en el inicio y el código se perdía.
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/db');
const authController = require('../src/controllers/authController');

const req = { user: { id: 7, email: 'a@b.co', role: 'client' }, headers: {} };
const mkRes = () => {
  const r = { body: null };
  r.status = () => r;
  r.json = (b) => { r.body = b; return r; };
  return r;
};

beforeEach(() => jest.clearAllMocks());

test('share_url usa /register?ref= y no lleva #', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 7, nombre: 'Ana', email: 'a@b.co', referral_code: 'GLOW927E' }] })
    .mockResolvedValueOnce({ rows: [{ n: 0 }] })
    .mockResolvedValueOnce({ rows: [{ total: '0' }] });

  const res = mkRes();
  await authController.getReferralInfo(req, res);

  expect(res.body.share_url).toContain('/register?ref=GLOW927E');
  expect(res.body.share_url).not.toContain('#');
  expect(res.body.share_message).toContain(res.body.share_url);
});
