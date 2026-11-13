/**
 * Alta con Google: cuando la cuenta nace, acredita los 100 XP de bienvenida.
 *
 * Este test existe por un defecto real: el controlador llamaba a
 * `xpBienvenidaService` sin haberlo importado, y la ruta reventaba con
 * «xpBienvenidaService is not defined» justo al crear la cuenta. Ningún test lo
 * vio porque ninguno recorría esa rama con un token válido.
 */
jest.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken() {
      return {
        getPayload: () => ({
          email: 'nueva@glowapp.test',
          name: 'Nueva',
          sub: 'g-123',
          email_verified: true,
        }),
      };
    }
  },
}));

jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  systemPool: { query: jest.fn() },
}));
jest.mock('../src/config/tenantRouting', () => ({
  runAsSystem: (_opt, fn) => fn({ query: (...a) => require('../src/config/db').pool.query(...a) }),
}));
jest.mock('../src/services/referralService', () => ({ atribuirInvitacion: jest.fn() }));
jest.mock('../src/services/xpBienvenidaService', () => ({
  acreditarXpBienvenida: jest.fn().mockResolvedValue({ acreditado: true, puntos: 100 }),
}));

const { pool } = require('../src/config/db');
const xpBienvenidaService = require('../src/services/xpBienvenidaService');
const oauthController = require('../src/controllers/oauthController');

function respuesta() {
  const res = { statusCode: 200, cuerpo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.cuerpo = b; return res; };
  return res;
}

beforeEach(() => jest.clearAllMocks());

test('la cuenta nueva con Google recibe los 100 XP de bienvenida', async () => {
  // 1) no existe   2) INSERT devuelve la cuenta
  pool.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 42, nombre: 'Nueva', email: 'nueva@glowapp.test', rol: 'CLIENTE' }] })
    .mockResolvedValue({ rows: [] });

  const res = respuesta();
  await oauthController.googleSignIn(
    { body: { idToken: 'token-valido' }, headers: {} },
    res
  );

  expect(xpBienvenidaService.acreditarXpBienvenida).toHaveBeenCalledWith({ userId: 42 });
  expect(res.cuerpo).toMatchObject({ success: true, es_nuevo: true });
});

test('si la cuenta ya existía, no vuelve a dar la bienvenida', async () => {
  pool.query.mockResolvedValue({ rows: [{ id: 7, nombre: 'Vieja', email: 'nueva@glowapp.test', rol: 'CLIENTE' }] });

  const res = respuesta();
  await oauthController.googleSignIn({ body: { idToken: 'token-valido' }, headers: {} }, res);

  expect(xpBienvenidaService.acreditarXpBienvenida).not.toHaveBeenCalled();
  expect(res.cuerpo.es_nuevo).toBe(false);
});
