const mockClient = { query: jest.fn() };

jest.mock('../config/db', () => ({ pool: {}, systemPool: {} }));
jest.mock('../config/tenantRouting', () => ({
  runAsSystem: jest.fn((_deps, callback) => callback(mockClient)),
}));

const adminModel = require('../modules/admin-glow/admin.model');
const tenantRouting = require('../config/tenantRouting');

describe('SaaS salon operational approval', () => {
  beforeEach(() => {
    mockClient.query.mockReset();
    tenantRouting.runAsSystem.mockImplementation((_deps, callback) => callback(mockClient));
  });

  test('includes salon owners in the admin operational listing', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    await adminModel.getProvidersOperationalStatus();

    expect(mockClient.query.mock.calls[0][0]).toContain("u.rol::text IN ('PRESTADOR', 'SALON')");
  });

  test('allows an eligible SALON owner to be enabled and audits the change', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{
        id: 17,
        nombre: 'QA Salon',
        rol: 'SALON',
        is_active: true,
        estado_operativo: 'EXPLORACION',
        revision_estado: 'APROBADA',
        rut_numero: '900123456',
        estatus_verificacion: 'APROBADO',
        documento_id_url: 'https://example.test/id.pdf',
        certificacion_url: 'https://example.test/acreditacion.pdf',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 17, nombre: 'QA Salon', estado_operativo: 'HABILITADO' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await adminModel.enableProviderOperational(17, 1);

    expect(result).toEqual(expect.objectContaining({ ok: true, alreadyEnabled: false }));
    expect(mockClient.query.mock.calls[0][0]).toContain("u.rol::text IN ('PRESTADOR', 'SALON')");
    expect(mockClient.query.mock.calls[1][0]).toContain("estado_operativo = 'HABILITADO'");
    expect(mockClient.query.mock.calls[2][0]).toContain('estado_operativo_historial');
    expect(mockClient.query.mock.calls[3][0]).toContain('admin_actions');
  });

  test('refuses SALON enablement when document review requirements are incomplete', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{
      id: 17,
      rol: 'SALON',
      is_active: true,
      estado_operativo: 'EXPLORACION',
      revision_estado: 'PENDIENTE',
      rut_numero: null,
      estatus_verificacion: 'PENDIENTE',
      documento_id_url: null,
      certificacion_url: null,
    }] });

    const result = await adminModel.enableProviderOperational(17, 1);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('REQUIREMENTS');
    expect(result.requisitos).toHaveLength(4);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });
});
