// backend/src/tests/accountDeletionT111.test.js
//
// T-111 — Cerrar la cuenta tiene que borrar de verdad.
//
// La ruta anonimizaba el usuario y revocaba el consentimiento, y respondía «tu cuenta
// y datos personales han sido eliminados» mientras los escaneos biométricos seguían en
// la base. Peor: si el borrado fallaba, se seguía afirmando lo mismo.

const mockPoolQuery = jest.fn();
jest.mock('../config/db', () => ({
  pool: { query: (...args) => mockPoolQuery(...args) },
}));

const mockDeleteBiometricData = jest.fn();
jest.mock('../services/consentService', () => ({
  deleteBiometricData: (...args) => mockDeleteBiometricData(...args),
}));

const { deleteAccount } = require('../controllers/authController');

const respuesta = () => {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
};

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockDeleteBiometricData.mockReset();
  mockPoolQuery.mockResolvedValue({ rowCount: 1 });
});

describe('T-111 — cierre de cuenta', () => {
  test('si no se pueden borrar los datos biométricos, no se cierra la cuenta', async () => {
    mockDeleteBiometricData.mockResolvedValue({ deleted: false, recordsAffected: 0, error: 'timeout' });
    const res = respuesta();

    await deleteAccount({ user: { id: 7 } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/datos biométricos/i);
    // La cuenta no se toca: el reintento tiene que ser posible.
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  test('si el borrado va bien, se anonimiza y se informa cuántos registros cayeron', async () => {
    mockDeleteBiometricData.mockResolvedValue({ deleted: true, recordsAffected: 9 });
    const res = respuesta();

    await deleteAccount({ user: { id: 7 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.biometric_records_deleted).toBe(9);
    expect(res.body.message).toMatch(/biométricos/i);

    const sentencias = mockPoolQuery.mock.calls.map(([sql]) => sql).join(' ');
    expect(sentencias).toMatch(/UPDATE biometric_consents/);
    expect(sentencias).toMatch(/UPDATE usuarios/);
  });

  test('el borrado biométrico ocurre antes de anonimizar el usuario', async () => {
    const orden = [];
    mockDeleteBiometricData.mockImplementation(async () => {
      orden.push('biometricos');
      return { deleted: true, recordsAffected: 3 };
    });
    mockPoolQuery.mockImplementation(async (sql) => {
      orden.push(/UPDATE usuarios/.test(sql) ? 'anonimizar' : 'revocar');
      return { rowCount: 1 };
    });

    await deleteAccount({ user: { id: 7 } }, respuesta());

    expect(orden[0]).toBe('biometricos');
    expect(orden.indexOf('anonimizar')).toBeGreaterThan(0);
  });
});
