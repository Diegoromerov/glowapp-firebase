const mockPoolQuery = jest.fn();
const mockAccept = jest.fn();
const mockAcceptLegacySalonInvitation = jest.fn();

jest.mock('../config/db', () => ({
  pool: { query: (...args) => mockPoolQuery(...args) },
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../services/saasMembershipService', () => ({
  accept: (...args) => mockAccept(...args),
  acceptLegacySalonInvitation: (...args) => mockAcceptLegacySalonInvitation(...args),
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    const id = req.headers['x-test-user-id'];
    if (id) req.user = { id: parseInt(id, 10), email: req.headers['x-test-user-email'] };
    next();
  },
}));

const request = require('supertest');
const express = require('express');
const salonRoutes = require('../routes/salonRoutes');

const app = express();
app.use(express.json());
app.use('/api/salon', salonRoutes);

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER = { id: 42, email: 'colaborador@glow.app' };
const aceptar = (token = TOKEN, email = USER.email) => request(app)
  .post('/api/salon/accept-invitation')
  .set('x-test-user-id', String(USER.id))
  .set('x-test-user-email', email)
  .send({ token });

describe('POST /api/salon/accept-invitation', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockAccept.mockReset();
    mockAcceptLegacySalonInvitation.mockReset();
  });

  test('usa primero el servicio canónico', async () => {
    mockAccept.mockResolvedValue({ business_profile_id: 'bp-3', role: 'MEMBER', sub_rol: 'EMPLEADO' });
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 3 }] });

    const res = await aceptar();

    expect(res.status).toBe(200);
    expect(res.body.salon_id).toBe(3);
    expect(mockAccept).toHaveBeenCalledWith({ token: TOKEN, user: USER });
    expect(mockAcceptLegacySalonInvitation).not.toHaveBeenCalled();
  });

  test('usa la ruta transaccional compatible solo cuando no hay invitación canónica', async () => {
    mockAccept.mockRejectedValue(Object.assign(new Error('no existe'), { status: 404 }));
    mockAcceptLegacySalonInvitation.mockResolvedValue({ salon_id: 3, sub_rol: 'EMPLEADO' });

    const res = await aceptar();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, salon_id: 3, sub_rol: 'EMPLEADO' });
    expect(mockAcceptLegacySalonInvitation).toHaveBeenCalledWith({ token: TOKEN, user: USER });
  });

  test('conserva el rechazo por correo distinto sin continuar a escrituras', async () => {
    mockAccept.mockRejectedValue(Object.assign(new Error('no existe'), { status: 404 }));
    mockAcceptLegacySalonInvitation.mockRejectedValue(Object.assign(new Error('Correo distinto'), {
      status: 403, code: 'INVITATION_EMAIL_MISMATCH',
    }));

    const res = await aceptar();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  test('no cae a la invitación antigua si falla la aceptación canónica por otra razón', async () => {
    mockAccept.mockRejectedValue(Object.assign(new Error('rol inválido'), { status: 409 }));

    const res = await aceptar();

    expect(res.status).toBe(409);
    expect(mockAcceptLegacySalonInvitation).not.toHaveBeenCalled();
  });

  test('token con formato inválido -> 400 sin tocar servicios ni base', async () => {
    const res = await aceptar('token-malo');

    expect(res.status).toBe(400);
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockAcceptLegacySalonInvitation).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
