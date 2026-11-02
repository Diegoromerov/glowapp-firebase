// backend/src/tests/salonInvitation.test.js
/**
 * Aceptación de invitación de equipo.
 *
 * La invitación es NOMINAL: `salon_invitaciones.email` dice para quién se emitió.
 * Antes, `acceptInvitation` buscaba la invitación por token y escribía en
 * `salon_miembros` con el `user_id` de quien estuviera conectado, sin comparar
 * con el correo invitado: cualquiera que consiguiera el token entraba al salón
 * con el sub_rol invitado (ADMINISTRADOR incluido) y, de paso, consumía la
 * invitación del invitado legítimo.
 *
 * También se verifica que la asociación y el consumo del token ocurran en UNA
 * sola sentencia: salvo que corra el middleware de contexto (tenantContext), dos
 * `pool.query` seguidas NO comparten transacción, así que un fallo entre ambas
 * dejaba el mismo token utilizable dos veces.
 */
const crypto = require('crypto');

const mockPoolQuery = jest.fn();

jest.mock('../config/db', () => ({
  pool: { query: (...args) => mockPoolQuery(...args) },
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    const id = req.headers['x-test-user-id'];
    if (id) {
      req.user = {
        id: parseInt(id, 10),
        email: req.headers['x-test-user-email'],
      };
    }
    next();
  },
}));

const request = require('supertest');
const express = require('express');
const salonRoutes = require('../routes/salonRoutes');

const app = express();
app.use(express.json());
// En index.js salonRoutes se monta bajo /api/salon.
app.use('/api/salon', salonRoutes);

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

const invitacionPara = (email) => ({
  rows: [
    {
      id: 7,
      salon_id: 3,
      email,
      sub_rol: 'EMPLEADO',
      expires_at: new Date('2999-01-01'),
      usado: false,
    },
  ],
});

const aceptar = (userId, email, token = TOKEN) =>
  request(app)
    .post('/api/salon/accept-invitation')
    .set('x-test-user-id', String(userId))
    .set('x-test-user-email', email)
    .send({ token });

describe('POST /api/salon/accept-invitation', () => {
  beforeEach(() => mockPoolQuery.mockReset());

  test('RECHAZA cuando la cuenta conectada no es la invitada (y no escribe nada)', async () => {
    mockPoolQuery.mockResolvedValueOnce(invitacionPara('colaborador@glow.app'));

    const res = await aceptar(42, 'otro@glow.app');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    // Solo la consulta de la invitación: no llegó al INSERT.
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  test('ACEPTA cuando la cuenta conectada es la invitada', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(invitacionPara('colaborador@glow.app'))
      .mockResolvedValueOnce({ rows: [] });

    const res = await aceptar(42, 'colaborador@glow.app');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sub_rol).toBe('EMPLEADO');
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  test('compara los correos sin distinguir mayúsculas', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(invitacionPara('Colaborador@Glow.App'))
      .mockResolvedValueOnce({ rows: [] });

    const res = await aceptar(42, 'colaborador@glow.app');

    expect(res.status).toBe(200);
  });

  test('consulta por el SHA-256 del token, nunca por el token en claro', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(invitacionPara('colaborador@glow.app'))
      .mockResolvedValueOnce({ rows: [] });

    await aceptar(42, 'colaborador@glow.app');

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual([TOKEN_HASH]);
    expect(sql).not.toContain(TOKEN);
    expect(mockPoolQuery.mock.calls[1][1][1]).toBe(42); // user_id de quien acepta
  });

  test('la consulta exige usado = false y expires_at en el futuro', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await aceptar(42, 'colaborador@glow.app');

    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/usado\s*=\s*false/);
    expect(sql).toMatch(/expires_at\s*>\s*NOW\(\)/);
  });

  test('token vencido o ya usado -> 400 y sin escribir', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await aceptar(42, 'colaborador@glow.app');

    expect(res.status).toBe(400);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  test('token con formato inválido -> 400 sin tocar la base', async () => {
    const res = await aceptar(42, 'colaborador@glow.app', 'no-es-un-token');

    expect(res.status).toBe(400);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  test('asociar al miembro y consumir la invitación van en UNA sola sentencia', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(invitacionPara('colaborador@glow.app'))
      .mockResolvedValueOnce({ rows: [] });

    await aceptar(42, 'colaborador@glow.app');

    const [sql, params] = mockPoolQuery.mock.calls[1];
    expect(sql.trim()).toMatch(/^WITH/i);
    // T-127: la tabla heredada ya no se escribe; la sentencia ata la membresía
    // canónica y el consumo del token.
    expect(sql).not.toMatch(/salon_miembros/);
    expect(sql).toMatch(/INSERT INTO memberships/);
    expect(sql).toMatch(/UPDATE salon_invitaciones/);
    expect(params).toEqual([3, 42, 'EMPLEADO', 7]);
  });
});
