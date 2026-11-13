/**
 * Borrado de cuenta: debe escribir en la conexión de la petición.
 *
 * El defecto que cubre este test costó un 502 de 30 s en producción. La ruta
 * anonimizaba el usuario desde OTRA conexión (`runAsSystem`) mientras la
 * transacción del request ya tenía un bloqueo sobre esa fila: nadie podía
 * avanzar. Aquí se fija el contrato — misma conexión, rol escalado dentro de
 * ella, y respuesta.
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/consentService', () => ({
  deleteBiometricData: jest.fn(),
}));
jest.mock('../src/config/tenantRouting', () => ({
  getActiveClient: jest.fn(),
  runAsSystem: jest.fn(),
}));

const { pool } = require('../src/config/db');
const consentService = require('../src/services/consentService');
const tenantRouting = require('../src/config/tenantRouting');
const authController = require('../src/controllers/authController');

function respuesta() {
  const res = { statusCode: 200, cuerpo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.cuerpo = b; return res; };
  return res;
}

const peticion = () => ({ user: { id: 9 } });

// `resetMocks: true` en jest.config.js borra las implementaciones del factory:
// cada test tiene que declarar la suya.
beforeEach(() => {
  jest.clearAllMocks();
  consentService.deleteBiometricData.mockResolvedValue({
    deleted: true,
    recordsAffected: 3,
  });
  tenantRouting.getActiveClient.mockReturnValue(null);
});

test('usa la conexión de la petición y no abre otra', async () => {
  const cliente = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
  tenantRouting.getActiveClient.mockReturnValue(cliente);

  const res = respuesta();
  await authController.deleteAccount(peticion(), res);

  expect(tenantRouting.runAsSystem).not.toHaveBeenCalled();
  const sentencias = cliente.query.mock.calls.map((c) => String(c[0]));
  expect(sentencias.some((s) => /SET LOCAL ROLE app_system/.test(s))).toBe(true);
  expect(sentencias.some((s) => /UPDATE usuarios/.test(s))).toBe(true);
  expect(res.statusCode).toBe(200);
  expect(res.cuerpo).toMatchObject({ success: true, biometric_records_deleted: 3 });
});

test('sin transacción de petición (job) cae a runAsSystem', async () => {
  tenantRouting.getActiveClient.mockReturnValue(null);
  tenantRouting.runAsSystem.mockImplementation((_deps, fn) =>
    fn({ query: jest.fn().mockResolvedValue({ rowCount: 1 }) })
  );

  const res = respuesta();
  await authController.deleteAccount(peticion(), res);

  expect(tenantRouting.runAsSystem).toHaveBeenCalled();
  expect(res.cuerpo.success).toBe(true);
});

test('si los biométricos no se borran, no toca la cuenta', async () => {
  consentService.deleteBiometricData.mockResolvedValueOnce({ deleted: false, error: 'boom' });
  tenantRouting.getActiveClient.mockReturnValue({ query: jest.fn() });

  const res = respuesta();
  await authController.deleteAccount(peticion(), res);

  expect(res.statusCode).toBe(500);
  expect(pool.query).not.toHaveBeenCalled();
});

test('si la cuenta no existe, responde 404 y no miente', async () => {
  tenantRouting.getActiveClient.mockReturnValue({
    query: jest.fn().mockResolvedValue({ rowCount: 0 }),
  });

  const res = respuesta();
  await authController.deleteAccount(peticion(), res);

  expect(res.statusCode).toBe(404);
});
