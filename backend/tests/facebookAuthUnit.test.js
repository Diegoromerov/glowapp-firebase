// Tests del controlador de Facebook que no dependen de base de datos ni de red.
//
// Cubren las dos guardas que importan antes de tocar la Graph API:
//   - sin accessToken no se intenta nada (400)
//   - sin FACEBOOK_APP_ID/SECRET no se acepta el token (501)
//
// El camino feliz (debug_token + /me) se prueba contra la Graph API real cuando
// las credenciales estén cargadas; aquí no se simula una verificación.

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('oauthController.facebookSignIn (guardas)', () => {
  const envOriginal = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...envOriginal };
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.ALLOW_MOCK_AUTH;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = envOriginal;
  });

  test('sin accessToken responde 400', async () => {
    const { facebookSignIn } = require('../src/controllers/oauthController');
    const res = mockRes();

    await facebookSignIn({ body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Falta el accessToken de Facebook' })
    );
  });

  test('sin FACEBOOK_APP_ID responde 501 y no emite JWT', async () => {
    const { facebookSignIn } = require('../src/controllers/oauthController');
    const res = mockRes();

    await facebookSignIn({ body: { accessToken: 'EAAB-token-de-prueba' } }, res);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Facebook no configurado' })
    );
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  test('con solo FACEBOOK_APP_ID (sin secret) tambien responde 501', async () => {
    process.env.FACEBOOK_APP_ID = '1234567890';
    const { facebookSignIn } = require('../src/controllers/oauthController');
    const res = mockRes();

    await facebookSignIn({ body: { accessToken: 'EAAB-token-de-prueba' } }, res);

    expect(res.status).toHaveBeenCalledWith(501);
  });
});
