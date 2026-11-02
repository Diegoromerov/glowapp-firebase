// E-02/T-127 — `/api/salon/my-salon` no debe inventar un salón.
// El defecto: cuando la consulta no encontraba nada, el controlador devolvía un
// objeto escrito a mano («Salón Elegance Studio», con NIT y dirección falsos) y
// la pantalla mostraba un negocio inexistente.

jest.mock('../config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../config/db');
const { getMySalon } = require('../controllers/salonController');

function resMock() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

const req = (id = 1042) => ({ user: { id } });

beforeEach(() => {
  pool.query.mockReset();
});

describe('GET /api/salon/my-salon', () => {
  it('sin membresía devuelve salon null, nunca un salón inventado', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = resMock();
    await getMySalon(req(999), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.salon).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Elegance|901888777|Calle 127/);
  });

  it('resuelve el salón por membresía, no sólo por id_dueno', async () => {
    // El usuario 1042 es OWNER por membresía de un salón cuyo dueño es otro.
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 14, nombre_salon: 'Salón Piloto Fontibón', nit: null, direccion: null,
        telefono: null, ciudad: 'Bogotá', plan_saas: 'PRO', id_dueno: 7,
        latitude: null, longitude: null, location_enabled: false, location_public: false,
      }],
    });
    pool.query.mockResolvedValue({ rows: [] }); // listSalonMembers

    const res = resMock();
    await getMySalon(req(1042), res);

    expect(res.body.salon).not.toBeNull();
    expect(res.body.salon.id).toBe(14);
    expect(res.body.salon.plan_saas).toBe('PRO');
    // PRO incluye gestión de equipo: la pestaña Equipo debe abrirse.
    expect(res.body.salon.entitlements).toContain('TEAM_MANAGEMENT');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM memberships/i);
    expect(pool.query.mock.calls[0][1]).toEqual([1042]);
  });
});
