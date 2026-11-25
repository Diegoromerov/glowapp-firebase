const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  authMiddleware(req, _res, next) {
    req.user = { id: 10, email: 'owner@glow.test' };
    next();
  },
}));

jest.mock('../middleware/saasContext', () => (req, _res, next) => {
  const role = req.get('x-test-role') || 'OWNER';
  req.saas = { tenantId: 20, name: 'Salón QA', plan: 'FREE_TRIAL', role, membershipId: 100 };
  next();
});

jest.mock('../services/saasMembershipService', () => ({
  list: jest.fn(async () => [{ user_id: 10, role: 'OWNER', status: 'ACTIVE' }]),
  invite: jest.fn(async () => ({ membershipId: 101, email: 'staff@glow.test', role: 'MEMBER', emailSent: false })),
  accept: jest.fn(async () => ({ id: 101, user_id: 10, role: 'MEMBER', status: 'ACTIVE' })),
  changeRole: jest.fn(async () => ({ id: 101, role: 'MANAGER', status: 'ACTIVE' })),
  setStatus: jest.fn(async () => ({ id: 101, role: 'MEMBER', status: 'SUSPENDED' })),
  resend: jest.fn(async () => ({ membershipId: 101, emailSent: false })),
}));

const { pool } = require('../config/db');
const membershipService = require('../services/saasMembershipService');
const saasTeamRoutes = require('../routes/saasTeamRoutes');

const app = express();
app.use(express.json());
app.use('/api/saas/team', saasTeamRoutes);

const asRole = (role, method, path) => request(app)[method](path).set('x-test-role', role);

describe('SaaS team HTTP role matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    membershipService.list.mockResolvedValue([{ user_id: 10, role: 'OWNER', status: 'ACTIVE' }]);
    membershipService.invite.mockResolvedValue({ membershipId: 101, email: 'staff@glow.test', role: 'MEMBER', emailSent: false });
    membershipService.changeRole.mockResolvedValue({ id: 101, role: 'MANAGER', status: 'ACTIVE' });
    membershipService.setStatus.mockResolvedValue({ id: 101, role: 'MEMBER', status: 'SUSPENDED' });
    membershipService.resend.mockResolvedValue({ membershipId: 101, emailSent: false });
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
  });

  afterEach(() => jest.restoreAllMocks());

  test.each(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'])(
    '%s can read the team, while only OWNER and ADMIN can read audit', async (role) => {
      const team = await asRole(role, 'get', '/api/saas/team');
      const audit = await asRole(role, 'get', '/api/saas/team/audit');

      expect(team.status).toBe(200);
      expect(membershipService.list).toHaveBeenCalledWith(20, 10);
      if (['OWNER', 'ADMIN'].includes(role)) expect(audit.status).toBe(200);
      else expect(audit.status).toBe(403);
    },
  );

  test.each(['OWNER', 'ADMIN'])(
    '%s can invite and manage membership status', async (role) => {
      const invite = await asRole(role, 'post', '/api/saas/team/invite')
        .send({ email: 'staff@glow.test', role: 'MEMBER' });
      const status = await asRole(role, 'patch', '/api/saas/team/101/status')
        .send({ status: 'SUSPENDED' });

      expect(invite.status).toBe(202);
      expect(status.status).toBe(200);
      expect(membershipService.invite).toHaveBeenCalledTimes(1);
      expect(membershipService.setStatus).toHaveBeenCalledTimes(1);
    },
  );

  test('only OWNER can change a member role', async () => {
    const owner = await asRole('OWNER', 'patch', '/api/saas/team/101/role')
      .send({ role: 'MANAGER' });
    const admin = await asRole('ADMIN', 'patch', '/api/saas/team/101/role')
      .send({ role: 'MANAGER' });

    expect(owner.status).toBe(200);
    expect(admin.status).toBe(403);
    expect(membershipService.changeRole).toHaveBeenCalledTimes(1);
  });

  test.each(['MANAGER', 'MEMBER', 'VIEWER'])(
    '%s cannot invite, change roles, suspend, remove, or resend invitations', async (role) => {
      const invite = await asRole(role, 'post', '/api/saas/team/invite')
        .send({ email: 'staff@glow.test', role: 'MEMBER' });
      const changeRole = await asRole(role, 'patch', '/api/saas/team/101/role')
        .send({ role: 'MANAGER' });
      const status = await asRole(role, 'patch', '/api/saas/team/101/status')
        .send({ status: 'SUSPENDED' });
      const remove = await asRole(role, 'delete', '/api/saas/team/101');
      const resend = await asRole(role, 'post', '/api/saas/team/101/resend-invite');

      for (const response of [invite, changeRole, status, remove, resend]) {
        expect(response.status).toBe(403);
      }
      expect(membershipService.invite).not.toHaveBeenCalled();
      expect(membershipService.changeRole).not.toHaveBeenCalled();
      expect(membershipService.setStatus).not.toHaveBeenCalled();
      expect(membershipService.resend).not.toHaveBeenCalled();
    },
  );
});

