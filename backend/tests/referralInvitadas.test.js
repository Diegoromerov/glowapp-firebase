/**
 * La invitante tiene que ver QUIÉN se unió, no solo cuántos.
 *
 * Antes la respuesta traía `referidos_convertidos: 0` y nada más: invitar se
 * sentía a ciegas. Ahora llega una lista con el nombre de pila y el estado del
 * premio. Este test fija ese contrato y el recorte del nombre.
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/db');
const authController = require('../src/controllers/authController');

function respuesta() {
  const res = { statusCode: 200, cuerpo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.cuerpo = b; return res; };
  return res;
}

beforeEach(() => jest.clearAllMocks());

function enrutar(porSql) {
  pool.query.mockImplementation((sql, params) => {
    for (const [patron, salida] of porSql) {
      if (patron.test(sql)) return Promise.resolve(salida);
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

test('devuelve las invitadas con nombre de pila y estado', async () => {
  enrutar([
    [/SELECT id, nombre, email, referral_code FROM usuarios/, {
      rows: [{ id: 5, nombre: 'Ana Perez', email: 'ana@x.co', referral_code: 'GLOWAA11' }],
    }],
    [/JOIN usuarios r ON r.id = u.referred_by_user_id/, { rows: [] }],
    [/FROM referral_conversions/, { rows: [{ convertidos: 1, puntos: 500 }] }],
    [/FROM usuarios\s+WHERE referred_by_user_id/, {
      rows: [
        { nombre: 'Carla Marcela Ruiz', created_at: '2026-11-01T10:00:00Z', referral_converted_at: '2026-11-02T10:00:00Z' },
        { nombre: 'Diana', created_at: '2026-11-03T10:00:00Z', referral_converted_at: null },
      ],
    }],
  ]);

  const res = respuesta();
  await authController.getReferralInfo({ user: { id: 5 } }, res);

  expect(res.cuerpo.invitadas).toEqual([
    { nombre: 'Carla', fecha: '2026-11-01T10:00:00Z', estado: 'premiada' },
    { nombre: 'Diana', fecha: '2026-11-03T10:00:00Z', estado: 'pendiente' },
  ]);
});

test('sin invitadas devuelve lista vacía, no null', async () => {
  enrutar([
    [/SELECT id, nombre, email, referral_code FROM usuarios/, {
      rows: [{ id: 5, nombre: 'Ana', email: 'ana@x.co', referral_code: 'GLOWAA11' }],
    }],
  ]);

  const res = respuesta();
  await authController.getReferralInfo({ user: { id: 5 } }, res);

  expect(res.cuerpo.invitadas).toEqual([]);
});

test('si la consulta falla, la pantalla sigue funcionando sin la lista', async () => {
  pool.query.mockImplementation((sql) => {
    if (/FROM usuarios\s+WHERE referred_by_user_id/.test(sql)) {
      return Promise.reject(new Error('boom'));
    }
    if (/SELECT id, nombre, email, referral_code FROM usuarios/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 5, nombre: 'Ana', email: 'a@x.co', referral_code: 'GLOWAA11' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const res = respuesta();
  await authController.getReferralInfo({ user: { id: 5 } }, res);

  expect(res.statusCode).toBe(200);
  expect(res.cuerpo.invitadas).toEqual([]);
  expect(res.cuerpo.referral_code).toBe('GLOWAA11');
});
