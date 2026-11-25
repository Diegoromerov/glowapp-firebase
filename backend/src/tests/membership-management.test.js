const request = require('supertest');
const express = require('express');

// This suite targets the current HTTP/controller contract. The authentication
// and membership-context middleware are isolated here; their behavior is
// covered by auth, membership-flow, and SaaS-context suites.
jest.mock('../middleware/auth', () => ({
  authMiddleware(req, _res, next) {
    req.user = { id: Number(req.get('x-test-user-id') || 1), email: 'owner@glow.test' };
    next();
  },
}));

jest.mock('../middleware/membership.middleware', () => (req, _res, next) => {
  req.membership = {
    business_profile_id: req.get('x-test-business-profile-id') || 'bp-100',
    role: req.get('x-test-role') || 'OWNER',
  };
  next();
});

jest.mock('../services/saasMembershipService', () => ({
  list: jest.fn(),
  invite: jest.fn(),
  changeRole: jest.fn(),
  setStatus: jest.fn(),
}));

const { pool } = require('../config/db');
const membershipService = require('../services/saasMembershipService');
const membershipRoutes = require('../routes/membershipRoutes');

const app = express();
app.use(express.json());
app.use('/api/v1/memberships', membershipRoutes);

function as(method, path, role = 'OWNER', userId = 1) {
  return request(app)[method](path)
    .set('x-test-role', role)
    .set('x-test-user-id', String(userId));
}

function serviceError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

describe('SaaS membership HTTP contract and route permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'bp-100', name: 'Salón QA', saas_plan: 'BASIC' }] });
  });

  afterEach(() => jest.restoreAllMocks());

  test('OWNER lists members using the canonical SaaS membership service', async () => {
    membershipService.list.mockResolvedValue([{
      id: 'mem-owner', user_id: 1, role: 'OWNER', status: 'ACTIVE',
      full_name: 'Dueño QA', email: 'owner@glow.test', created_at: '2026-11-25T00:00:00Z',
    }]);

    const res = await as('get', '/api/v1/memberships');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([expect.objectContaining({
      id: 'mem-owner', role: 'OWNER', status: 'ACTIVE',
      user: expect.objectContaining({ id: 1, nombre: 'Dueño QA', email: 'owner@glow.test' }),
    })]);
    expect(membershipService.list).toHaveBeenCalledWith('bp-100', 1);
  });

  test('OWNER invitation returns the canonical service result without exposing a token', async () => {
    membershipService.invite.mockResolvedValue({
      membershipId: 'mem-pending', email: 'staff@glow.test', role: 'MEMBER',
      expiresAt: '2026-12-02T00:00:00Z', emailSent: true,
    });

    const res = await as('post', '/api/v1/memberships/invite')
      .send({ email: 'staff@glow.test', role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ membershipId: 'mem-pending', emailSent: true });
    expect(res.body.data).not.toHaveProperty('token');
    expect(membershipService.invite).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'bp-100', tenantName: 'Salón QA', plan: 'BASIC', actorId: 1,
      email: 'staff@glow.test', role: 'MEMBER',
    }));
  });

  test('invitation errors preserve service status for an unregistered account', async () => {
    membershipService.invite.mockRejectedValue(serviceError('La persona debe crear su cuenta GlowApp antes de recibir una invitación.', 404));

    const res = await as('post', '/api/v1/memberships/invite')
      .send({ email: 'new@glow.test', role: 'MEMBER' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/crear su cuenta GlowApp/);
  });

  test('active duplicate invitation errors preserve conflict status', async () => {
    membershipService.invite.mockRejectedValue(serviceError('El usuario ya es miembro activo', 409));

    const res = await as('post', '/api/v1/memberships/invite')
      .send({ email: 'staff@glow.test', role: 'MEMBER' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('El usuario ya es miembro activo');
  });

  test('MEMBER cannot invite or change roles even when the controller is reachable', async () => {
    const invite = await as('post', '/api/v1/memberships/invite', 'MEMBER', 5)
      .send({ email: 'new@glow.test', role: 'MEMBER' });
    const role = await as('patch', '/api/v1/memberships/mem-2/role', 'MEMBER', 5)
      .send({ role: 'MANAGER' });

    expect(invite.status).toBe(403);
    expect(role.status).toBe(403);
    expect(invite.body.error).toBe('FORBIDDEN');
    expect(role.body.error).toBe('FORBIDDEN');
    expect(membershipService.invite).not.toHaveBeenCalled();
    expect(membershipService.changeRole).not.toHaveBeenCalled();
  });

  test('OWNER cannot change or remove the OWNER membership', async () => {
    membershipService.changeRole.mockRejectedValue(serviceError('No se puede cambiar el rol del propietario', 400));
    membershipService.setStatus.mockRejectedValue(serviceError('No se puede suspender ni retirar al propietario', 400));

    const role = await as('patch', '/api/v1/memberships/mem-owner/role').send({ role: 'MEMBER' });
    const remove = await as('delete', '/api/v1/memberships/mem-owner');

    expect(role.status).toBe(400);
    expect(role.body.error).toMatch(/rol del propietario/);
    expect(remove.status).toBe(400);
    expect(remove.body.error).toMatch(/retirar al propietario/);
    expect(membershipService.changeRole).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'bp-100', memberId: 'mem-owner', actorId: 1, role: 'MEMBER',
    }));
    expect(membershipService.setStatus).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'bp-100', memberId: 'mem-owner', actorId: 1, status: 'REMOVED',
    }));
  });
});
