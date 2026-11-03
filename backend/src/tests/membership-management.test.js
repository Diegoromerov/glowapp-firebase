// backend/src/tests/membership-management.test.js
const request = require('supertest');
const express = require('express');
const { Membership, User, BusinessProfile } = require('../models');
const membershipRoutes = require('../routes/membershipRoutes');

// Crear una app express ligera para probar el router de membresías
const app = express();
app.use(express.json());
app.use('/api/v1/memberships', membershipRoutes);

const { pool } = require('../config/db');

describe('Suite de Integración: SaaS Team & Membership Management Module (Fase 2B.5 / Goal 03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 1, rol: 'PRESTADOR', tenant_id: 1 }] });
  });

  describe('1. Controller Logic & Security Guards (membershipController.js)', () => {
    test('GET /api/v1/memberships — Retorna los miembros del negocio activo', async () => {
      // Mock de autenticación y membresía activa (OWNER)
      const mockMemberships = [
        {
          id: 'mem-1',
          user_id: 1,
          role: 'OWNER',
          status: 'ACTIVE',
          created_at: new Date(),
          user: { id: 1, nombre: 'Propietario Demo', email: 'owner@glow.com', phone: '3001234567' }
        },
        {
          id: 'mem-2',
          user_id: 2,
          role: 'MEMBER',
          status: 'ACTIVE',
          created_at: new Date(),
          user: { id: 2, nombre: 'Empleado Demo', email: 'staff@glow.com', phone: '3007654321' }
        }
      ];

      jest.spyOn(Membership, 'findAll').mockResolvedValue(mockMemberships);

      // Simular middleware req.user
      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 1, email: 'owner@glow.com' }, getJwtSecret());

      // Mockear resolución de membresía activa para middleware
      jest.spyOn(Membership, 'findAll')
        .mockImplementation(async (options) => {
          if (options && options.where && options.where.business_profile_id) {
            return mockMemberships; // Para el controller (filtrado por business_profile_id)
          }
          return [{
            id: 'mem-1',
            user_id: 1,
            business_profile_id: 'bp-100',
            role: 'OWNER',
            status: 'ACTIVE',
            businessProfile: { id: 'bp-100', name: 'Salón Principal' }
          }]; // Para el membershipMiddleware
        });

      const res = await request(app)
        .get('/api/v1/memberships')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].user.email).toBe('owner@glow.com');
    });

    test('POST /api/v1/memberships/invite — Rechaza invitación si el usuario no existe (404)', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 1, email: 'owner@glow.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-1',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      }]);

      const res = await request(app)
        .post('/api/v1/memberships/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'inexistente@glow.com', role: 'MEMBER' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('USER_NOT_FOUND');
    });

    test('POST /api/v1/memberships/invite — Rechaza invitación si el usuario ya es miembro del negocio (400)', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue({ id: 2, email: 'existente@glow.com' });
      jest.spyOn(Membership, 'findOne').mockResolvedValue({ id: 'mem-2', user_id: 2, business_profile_id: 'bp-100' });

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 1, email: 'owner@glow.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-1',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      }]);

      const res = await request(app)
        .post('/api/v1/memberships/invite')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'existente@glow.com', role: 'MEMBER' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MEMBERSHIP_EXISTS');
    });

    test('PATCH /api/v1/memberships/:id/role — Impide degradar o modificar el rol del OWNER (400)', async () => {
      jest.spyOn(Membership, 'findOne').mockResolvedValue({
        id: 'mem-owner',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      });

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 1, email: 'owner@glow.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-owner',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      }]);

      const res = await request(app)
        .patch('/api/v1/memberships/mem-owner/role')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CANNOT_MODIFY_OWNER');
    });

    test('DELETE /api/v1/memberships/:id — Impide eliminar al OWNER del negocio (400)', async () => {
      jest.spyOn(Membership, 'findOne').mockResolvedValue({
        id: 'mem-owner',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      });

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 1, email: 'owner@glow.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-owner',
        user_id: 1,
        business_profile_id: 'bp-100',
        role: 'OWNER',
        status: 'ACTIVE'
      }]);

      const res = await request(app)
        .delete('/api/v1/memberships/mem-owner')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CANNOT_REMOVE_OWNER');
    });

    test('2. RBAC Enforcement — Bloquea a rol MEMBER intentar invitar usuarios (403 Forbidden)', async () => {
      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const memberToken = jwt.sign({ id: 5, email: 'member@glow.com' }, getJwtSecret());

      // Contexto activo con rol MEMBER
      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-5',
        user_id: 5,
        business_profile_id: 'bp-100',
        role: 'MEMBER',
        status: 'ACTIVE'
      }]);

      const res = await request(app)
        .post('/api/v1/memberships/invite')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ email: 'nuevo@glow.com', role: 'MEMBER' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });
});
