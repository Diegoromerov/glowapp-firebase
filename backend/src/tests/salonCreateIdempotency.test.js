jest.mock('../config/db', () => ({ pool: {} }));
jest.mock('../config/tenantRouting', () => ({
  getActiveClient: jest.fn(),
  runAsSystem: jest.fn(),
}));
jest.mock('../config/saasEntitlements', () => ({
  hasEntitlement: jest.fn(),
  PLAN_ENTITLEMENTS: { FREE_TRIAL: [] },
  SAAS_CAPABILITIES: { MAP_VISIBILITY: 'MAP_VISIBILITY' },
}));
jest.mock('../services/salonIdentity', () => ({
  ensureSalonOwnerIdentity: jest.fn(),
}));
jest.mock('../services/saasMembershipService', () => ({}));
jest.mock('../services/salonMembership', () => ({
  listSalonMembers: jest.fn(),
  getMemberRole: jest.fn(),
  canAdminSalon: jest.fn(),
  ensureMembership: jest.fn(),
}));

const tenantRouting = require('../config/tenantRouting');
const { ensureSalonOwnerIdentity } = require('../services/salonIdentity');
const { createSalon } = require('../controllers/salonController');

function responseMock() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('createSalon — reintento idempotente', () => {
  it('devuelve la sede del primer POST y no inserta otra cuando se repite', async () => {
    const salon = {
      id: 77,
      nombre_salon: 'Salón de prueba',
      nit: null,
      direccion: null,
      telefono: null,
      ciudad: 'Bogotá',
      plan_saas: 'FREE_TRIAL',
      latitude: null,
      longitude: null,
      location_enabled: false,
      location_public: true,
    };
    let salonExiste = false;
    let inserciones = 0;
    let existingSalonQuery = '';
    const client = {
      query: jest.fn(async (sql) => {
        const query = sql.replace(/\s+/g, ' ').trim();
        if (/FROM salones s JOIN memberships m/i.test(query)) {
          existingSalonQuery = query;
          return { rows: salonExiste ? [salon] : [] };
        }
        if (/INSERT INTO salones/i.test(query)) {
          inserciones += 1;
          salonExiste = true;
          return { rows: [salon] };
        }
        return { rows: [] };
      }),
    };
    tenantRouting.getActiveClient.mockReturnValue(client);
    ensureSalonOwnerIdentity.mockResolvedValue({ provisioned: true });

    const request = {
      user: { id: 42 },
      body: { nombre_salon: salon.nombre_salon, ciudad: salon.ciudad },
    };
    const firstResponse = responseMock();
    await createSalon(request, firstResponse);
    const retryResponse = responseMock();
    await createSalon(request, retryResponse);

    expect(firstResponse.statusCode).toBe(201);
    expect(firstResponse.body.created).toBe(true);
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.body.created).toBe(false);
    expect(retryResponse.body.salon.id).toBe(salon.id);
    expect(inserciones).toBe(1);
    expect(existingSalonQuery).toMatch(/bp\.saas_plan AS plan_saas/i);
    expect(existingSalonQuery).toMatch(/JOIN business_profiles bp ON bp\.id = s\.business_profile_id/i);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(73001, $1::integer)',
      [42],
    );
  });
});
