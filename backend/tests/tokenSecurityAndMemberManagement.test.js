const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_2026_at_least_32_chars_long';
process.env.JWT_SECRET = JWT_SECRET;

const { pool } = require('../src/config/db');

// ownerGuard abre una transacción real (runInTenantTransaction) y necesita
// `pool.connect`. Los bloques de abajo solo reemplazan `pool.query`, así que se
// entrega un cliente que delega en el mock y libera sin hacer nada.
const ORIGINAL_QUERY = pool.query;
const REAL_CONNECT = pool.connect.bind(pool);
pool.connect = async () => (pool.query === ORIGINAL_QUERY
  ? REAL_CONNECT()
  : { query: (text, params) => pool.query(text, params), release: () => {} });
const salonController = require('../src/controllers/salonController');
const salonRoutes = require('../src/routes/salonRoutes');
const { requireOwnerRole, protectOwnerMember } = require('../src/middleware/ownerGuard');

const app = express();
app.use(express.json());
app.use('/api/salon', salonRoutes);

describe('SHA-256 Token Security & Owner Member Management Tests', () => {
  let originalQuery;

  beforeAll(() => {
    originalQuery = pool.query;
  });

  afterEach(() => {
    pool.query = originalQuery;
  });

  test('inviteMember debe almacenar únicamente el hash SHA-256 (64 hex) en la BD y responder con token crudo (32 hex)', async () => {
    let insertedTokenHash = null;

    pool.query = jest.fn().mockImplementation((text, params) => {
      // Mock de verificación de permisos: E-02b lee el rol de `memberships`.
      if (text.includes('FROM memberships')) {
        return Promise.resolve({ rows: [{ role: 'OWNER', sub_rol: 'DUEÑO' }] });
      }
      // Mock de inserción en salon_invitaciones
      if (text.includes('INSERT INTO salon_invitaciones')) {
        insertedTokenHash = params[3];
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const req = {
      user: { id: 10 },
      body: {
        salon_id: 1,
        email: 'empleado@salonglow.com',
        sub_rol: 'EMPLEADO',
      },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await salonController.inviteMember(req, res);

    expect(res.json).toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0];

    expect(responseData.success).toBe(true);
    expect(responseData.invitation_token).toBeDefined();
    // Raw token de 32 hex
    expect(responseData.invitation_token).toMatch(/^[0-9a-f]{32}$/i);
    expect(responseData.invite_link).toContain(responseData.invitation_token);

    // El hash insertado en BD debe ser el SHA-256 de 64 hex del token en claro
    const expectedHash = crypto
      .createHash('sha256')
      .update(responseData.invitation_token)
      .digest('hex');

    expect(insertedTokenHash).toBe(expectedHash);
    expect(insertedTokenHash).toMatch(/^[0-9a-f]{64}$/i);
    expect(insertedTokenHash).not.toBe(responseData.invitation_token);
  });

  test('acceptInvitation debe calcular el hash SHA-256 del token en claro (e insensible a mayúsculas) antes de buscar en BD', async () => {
    const rawTokenUpper = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
    const rawTokenLower = rawTokenUpper.toLowerCase();
    const expectedHash = crypto
      .createHash('sha256')
      .update(rawTokenLower)
      .digest('hex');

    let searchedTokenParam = null;

    pool.query = jest.fn().mockImplementation((text, params) => {
      if (text.includes('FROM salon_invitaciones')) {
        searchedTokenParam = params[0];
        return Promise.resolve({
          rows: [
            {
              id: 1,
              salon_id: 1,
              email: 'empleado@salonglow.com',
              sub_rol: 'EMPLEADO',
              expires_at: new Date(Date.now() + 10000),
              usado: false,
            },
          ],
        });
      }
      if (text.includes('INSERT INTO salon_miembros') || text.includes('UPDATE salon_invitaciones')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    const req = {
      user: { id: 20 },
      body: { token: rawTokenUpper },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await salonController.acceptInvitation(req, res);

    expect(searchedTokenParam).toBe(expectedHash);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        salon_id: 1,
        sub_rol: 'EMPLEADO',
      })
    );
  });

  test('acceptInvitation debe rechazar tokens de longitud incorrecta o formato no hexadecimal', async () => {
    const reqInvalidFormat = {
      user: { id: 20 },
      body: { token: 'token-invalido-sin-hex!!!' },
    };
    const resInvalidFormat = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await salonController.acceptInvitation(reqInvalidFormat, resInvalidFormat);
    expect(resInvalidFormat.status).toHaveBeenCalledWith(400);

    const reqInvalidLength = {
      user: { id: 20 },
      body: { token: 'a1b2c3' }, // Demasiado corto
    };
    const resInvalidLength = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await salonController.acceptInvitation(reqInvalidLength, resInvalidLength);
    expect(resInvalidLength.status).toHaveBeenCalledWith(400);
  });

  test('protectOwnerMember bloquea la modificación o eliminación si es el único propietario del salón', async () => {
    pool.query = jest.fn().mockImplementation((text, params) => {
      if (/SELECT m\.user_id[\s\S]*FROM memberships/i.test(text)) {
        // ID 100 es el único DUEÑO del salón
        return Promise.resolve({ rows: [{ user_id: 100 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const req = {
      salonId: 1,
      params: { memberId: '100' },
      body: {},
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await protectOwnerMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'No se puede modificar, degradar ni desactivar al único propietario del salón.',
      })
    );
  });

  test('Prueba HTTP Integration con Supertest: Cadena Completa de Middleware en salonRoutes', async () => {
    const ownerToken = jwt.sign({ id: 10, role: 'SALON', email: 'owner@salonglow.com' }, JWT_SECRET);
    const adminToken = jwt.sign({ id: 20, role: 'SALON', email: 'admin@salonglow.com' }, JWT_SECRET);

    pool.query = jest.fn().mockImplementation((text, params) => {
      // 0. authMiddleware query a la tabla usuarios
      if (/SELECT rol, tenant_id FROM usuarios/i.test(text)) {
        return Promise.resolve({ rows: [{ rol: 'SALON', tenant_id: 1 }] });
      }
      // 1. Verificación de membresía en ownerGuard
      if (/AS sub_rol[\s\S]*FROM memberships/i.test(text)) {
        const userId = params[1];
        if (userId === 10) return Promise.resolve({ rows: [{ sub_rol: 'DUEÑO' }] });
        if (userId === 20) return Promise.resolve({ rows: [{ sub_rol: 'ADMINISTRADOR' }] });
        return Promise.resolve({ rows: [] });
      }
      // Verificación de lista de DUEÑOS en protectOwnerMember
      if (/SELECT m\.user_id[\s\S]*FROM memberships/i.test(text)) {
        return Promise.resolve({ rows: [{ user_id: 10 }] }); // 10 es el único propietario
      }
      // UPDATE en controlador
      if (text.includes('UPDATE salon_miembros')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });

    // 1. Intentar actualizar rol siendo solo ADMINISTRADOR (debe rebotar 403 por requireOwnerRole)
    const resAdmin = await request(app)
      .patch('/api/salon/1/members/30/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sub_rol: 'RECEPCIONISTA' });

    expect(resAdmin.statusCode).toBe(403);
    expect(resAdmin.body.error).toContain('No tienes permisos');

    // 2. Intentar modificar al único DUEÑO (ID 10) siendo OWNER (debe rebotar 409 por protectOwnerMember)
    const resOwnerSelf = await request(app)
      .patch('/api/salon/1/members/10/role')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sub_rol: 'RECEPCIONISTA' });

    expect(resOwnerSelf.statusCode).toBe(409);
    expect(resOwnerSelf.body.error).toContain('único propietario');

    // 3. Modificar con éxito a un empleado (ID 30) siendo OWNER
    const resSuccess = await request(app)
      .patch('/api/salon/1/members/30/role')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sub_rol: 'RECEPCIONISTA' });

    expect(resSuccess.statusCode).toBe(200);
    expect(resSuccess.body.success).toBe(true);
    expect(resSuccess.body.new_sub_rol).toBe('RECEPCIONISTA');
  });
});
