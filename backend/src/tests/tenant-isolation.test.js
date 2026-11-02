// backend/src/tests/tenant-isolation.test.js
const request = require('supertest');
const express = require('express');
const { Service, Membership } = require('../models');
const serviceRoutes = require('../routes/serviceRoutes');
const { pool } = require('../config/db');

// Crear app Express para probar el router de servicios
const app = express();
app.use(express.json());
app.use('/api', serviceRoutes);

// Servicios del Salón A (el negocio del solicitante).
const SERVICIOS_SALON_A = [
  { id: 'srv-a1', provider_id: 101, business_profile_id: 'bp-salon-a', name: 'Corte Caballero Salón A', description: null, price: '25.00', duration_minutes: 30, category: null, is_active: true },
  { id: 'srv-a2', provider_id: 101, business_profile_id: 'bp-salon-a', name: 'Barba Salón A', description: null, price: '15.00', duration_minutes: 20, category: null, is_active: true },
];

// Sentencias realmente ejecutadas, para poder verificar el predicado de aislamiento.
let sqlLog = [];

// Devuelve SOLO el predicado de la sentencia (desde WHERE hasta RETURNING/ORDER BY).
// Hace falta este recorte porque las columnas de salida tambien listan business_profile_id:
// con un `toContain` sobre toda la sentencia, quitar el filtro de tenant no rompia nada.
// Lo detecto la prueba de mutacion.
function predicado(sql) {
  const start = sql.search(/\bWHERE\b/i);
  if (start < 0) return '';
  let end = sql.length;
  for (const kw of [/\bRETURNING\b/i, /\bORDER BY\b/i]) {
    const i = sql.slice(start).search(kw);
    if (i >= 0) end = Math.min(end, start + i);
  }
  return sql.slice(start, end);
}

describe('Suite de Integración: Anti-Tenant-Leakage & Data Scope Audit (Fase 2B.6 / Goal 04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sqlLog = [];

    // Despacho por sentencia. El mock anterior devolvia la MISMA fila
    // ({ id: 101, rol: 'PRESTADOR' }) para TODA consulta: el UPDATE/DELETE acotado por
    // tenant siempre veia 1 fila y el controlador respondia 200, asi que estos tests
    // daban 200 por construccion del mock y nunca comprobaban el aislamiento.
    jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      sqlLog.push({ sql: q, params });

      // Resolución de identidad (middleware de auth)
      if (/app_usuario_identidad/.test(q)) {
        return { rows: [{ id: 101, rol: 'PRESTADOR', tenant_id: 1 }] };
      }
      // Listado de servicios del negocio del solicitante
      if (/FROM services/i.test(q) && /business_profile_id/i.test(q)) {
        return { rows: SERVICIOS_SALON_A };
      }
      // UPDATE / DELETE sobre un servicio ajeno: el WHERE acotado por tenant no alcanza
      // ninguna fila, así que el controlador DEBE responder 404.
      return { rows: [] };
    });
  });

  describe('1. Filtrado de Servicios por Contexto Activo (Multi-Tenancy)', () => {
    test('GET /api/services/provider — Solo retorna servicios pertenecientes al businessProfileId activo', async () => {
      const mockServicesBusinessA = [
        { id: 'srv-a1', name: 'Corte Caballero Salón A', price: '25.00', duration_minutes: 30, is_active: true, business_profile_id: 'bp-salon-a' },
        { id: 'srv-a2', name: 'Barba Salón A', price: '15.00', duration_minutes: 20, is_active: true, business_profile_id: 'bp-salon-a' }
      ];

      jest.spyOn(Service, 'findAll').mockImplementation(async (options) => {
        // Verificar que la cláusula WHERE contenga la condición de aislamiento
        return mockServicesBusinessA;
      });

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const token = jwt.sign({ id: 101, email: 'owner@salona.com' }, getJwtSecret());

      // Mockear membresía activa en Salón A
      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-101',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .get('/api/services/provider')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].business_profile_id).toBe('bp-salon-a');

      // El aislamiento no lo puede garantizar el mock: lo garantiza el predicado de la
      // sentencia. Si alguien lo elimina del SQL, este test cae.
      const select = sqlLog.find((e) => /FROM services/i.test(e.sql));
      expect(select).toBeDefined();
      // Mirar SOLO el WHERE: el SELECT ya lista business_profile_id en sus columnas, asi
      // que un toContain sobre toda la sentencia pasaria aunque el filtro no existiera.
      // Lo detecto la prueba de mutacion (quitar el WHERE no rompia el test).
      expect(predicado(select.sql)).toContain('business_profile_id');
      expect(select.params).toContain('bp-salon-a');
    });
  });

  describe('2. Anti-IDOR Security Guards (Protección de Recursos Cruzados)', () => {
    test('PUT /api/services/:id — Rechaza modificación (404) si un usuario del Negocio A intenta editar un servicio del Negocio B', async () => {
      // Simular que la búsqueda por (id + business_profile_id del usuario) no devuelve resultados
      jest.spyOn(Service, 'findOne').mockResolvedValue(null);

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const tokenUserA = jwt.sign({ id: 101, email: 'user@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-101',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .put('/api/services/srv-perteneciente-a-salon-b')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          name: 'Intento Hackeo Nombre',
          price: 1.00,
          duration_minutes: 10
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SERVICE_NOT_FOUND');

      // La sentencia ejecutada debe acotar por tenant: un UPDATE sin ese predicado
      // afectaría al servicio del Salón B aunque la respuesta fuese 404.
      const upd = sqlLog.find((e) => /^UPDATE services/i.test(e.sql));
      expect(upd).toBeDefined();
      // Solo el WHERE (el RETURNING tambien lista business_profile_id).
      expect(predicado(upd.sql)).toContain('business_profile_id');
      expect(upd.params).toContain('srv-perteneciente-a-salon-b');
    });

    test('DELETE /api/services/:id — Rechaza eliminación (404) si un usuario del Negocio A intenta eliminar un servicio del Negocio B', async () => {
      jest.spyOn(Service, 'findOne').mockResolvedValue(null);

      const jwt = require('jsonwebtoken');
      const { getJwtSecret } = require('../config/jwt');
      const tokenUserA = jwt.sign({ id: 101, email: 'user@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-101',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .delete('/api/services/srv-perteneciente-a-salon-b')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SERVICE_NOT_FOUND');

      const del = sqlLog.find((e) => /is_active = false/i.test(e.sql));
      expect(del).toBeDefined();
      // Solo el WHERE (defensivo: el RETURNING podria listarlo en el futuro).
      expect(predicado(del.sql)).toContain('business_profile_id');
      expect(del.params).toContain('srv-perteneciente-a-salon-b');
    });
  });
});
