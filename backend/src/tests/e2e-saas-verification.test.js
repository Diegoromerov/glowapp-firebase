// backend/src/tests/e2e-saas-verification.test.js
const request = require('supertest');
const express = require('express');
const { Service, Membership, User, BusinessProfile } = require('../models');
const serviceRoutes = require('../routes/serviceRoutes');
const membershipRoutes = require('../routes/membershipRoutes');
const { pool } = require('../config/db');

// Crear app Express para pruebas E2E
const app = express();
app.use(express.json());
app.use('/api', serviceRoutes);
app.use('/api/v1/memberships', membershipRoutes);

// Servicios del Salón A (el negocio autenticado).
const SERVICIOS_SALON_A = [
  { id: 'srv-a1', provider_id: 101, business_profile_id: 'bp-salon-a', name: 'Corte Salón A', description: null, price: '30.00', duration_minutes: 45, category: null, is_active: true },
];

// Sentencias realmente ejecutadas + sus parametros: es lo que permite verificar que el
// aislamiento viaja en el SQL y en los binds, no en el mock.
let sqlLog = [];

// Devuelve SOLO el predicado de la sentencia (desde WHERE hasta RETURNING/ORDER BY).
// Las columnas de salida tambien listan business_profile_id, asi que un toContain sobre
// toda la sentencia pasaria aunque el filtro de tenant no existiera.
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

describe('Suite E2E de Verificación SaaS & Multi-Tenancy (Fase 2B.7 / Goal 05)', () => {
  const jwt = require('jsonwebtoken');
  const { getJwtSecret } = require('../config/jwt');

  beforeEach(() => {
    jest.clearAllMocks();
    sqlLog = [];

    // Despacho por sentencia. El mock anterior devolvia la MISMA fila
    // ({ id: 1, rol: 'PRESTADOR' }) para TODA consulta: el UPDATE acotado por tenant
    // siempre veia 1 fila (-> 200 en el test IDOR) y el listado devolvia esa fila con
    // forma de servicio (-> business_profile_id undefined).
    jest.spyOn(pool, 'query').mockImplementation(async (sql, params) => {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      sqlLog.push({ sql: q, params });

      if (/app_usuario_identidad/.test(q)) {
        return { rows: [{ id: 101, rol: 'PRESTADOR', tenant_id: 1 }] };
      }

      // INSERT: la fila devuelta se construye con los PARAMETROS que envio el controlador.
      // Si el business_profile_id saliera del body en vez del contexto autenticado, el test
      // lo veria reflejado en la respuesta.
      if (/^INSERT INTO services/i.test(q)) {
        return {
          rows: [{
            id: 'srv-nuevo',
            provider_id: params[0],
            business_profile_id: params[1],
            name: params[2],
            description: params[3],
            price: params[4],
            duration_minutes: params[5],
            category: params[6],
            is_active: params[7],
          }],
        };
      }

      if (/FROM services/i.test(q) && /business_profile_id/i.test(q)) {
        return { rows: SERVICIOS_SALON_A };
      }

      // UPDATE / DELETE sobre un servicio ajeno: el WHERE acotado por tenant no alcanza
      // ninguna fila, asi que el controlador DEBE responder 404.
      return { rows: [] };
    });
  });

  describe('1. Aislamiento E2E Multi-Inquilino (Salón A vs Salón B)', () => {
    test('Usuario del Salón A solo visualiza servicios pertenecientes al Salón A', async () => {
      const tokenA = jwt.sign({ id: 101, email: 'owner@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-a',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .get('/api/services/provider')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].business_profile_id).toBe('bp-salon-a');

      // El aislamiento no lo puede garantizar el mock: lo garantiza el predicado de la
      // sentencia. Si alguien lo elimina del SQL, este test cae.
      const select = sqlLog.find((e) => /FROM services/i.test(e.sql));
      expect(select).toBeDefined();
      expect(predicado(select.sql)).toContain('business_profile_id');
      expect(select.params).toContain('bp-salon-a');
    });

    test('Soporta pre-selección de contexto con encabezado x-business-profile-id', async () => {
      const tokenUser = jwt.sign({ id: 101, email: 'owner@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findOne').mockResolvedValue({
        id: 'mem-a',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      });

      const res = await request(app)
        .get('/api/services/provider')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('x-business-profile-id', 'bp-salon-a');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const select = sqlLog.find((e) => /FROM services/i.test(e.sql));
      expect(select).toBeDefined();
      expect(select.params).toContain('bp-salon-a');
    });
  });

  describe('2. Pruebas de Resistencia Anti-IDOR & Inyección de Contexto', () => {
    test('Ataque IDOR: Usuario A no puede modificar un servicio perteneciente al Salón B (404)', async () => {
      const tokenA = jwt.sign({ id: 101, email: 'user@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-a',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .put('/api/services/srv-salon-b')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Nombre Alterado', price: 5.00, duration_minutes: 15 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SERVICE_NOT_FOUND');

      // La sentencia ejecutada debe acotar por tenant: un UPDATE sin ese predicado
      // afectaria al servicio del Salon B aunque la respuesta fuese 404.
      const upd = sqlLog.find((e) => /^UPDATE services/i.test(e.sql));
      expect(upd).toBeDefined();
      expect(predicado(upd.sql)).toContain('business_profile_id');
      expect(upd.params).toContain('srv-salon-b');
    });

    test('Inmunidad a inyección en Body: Forzar business_profile_id ajeno en el body no sobreescribe el contexto autenticado', async () => {
      const tokenA = jwt.sign({ id: 101, email: 'owner@salona.com' }, getJwtSecret());

      jest.spyOn(Membership, 'findAll').mockResolvedValue([{
        id: 'mem-a',
        user_id: 101,
        business_profile_id: 'bp-salon-a',
        role: 'OWNER',
        status: 'ACTIVE',
        businessProfile: { id: 'bp-salon-a', name: 'Salón A' }
      }]);

      const res = await request(app)
        .post('/api/services')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Servicio Seguro',
          price: 40.0,
          duration_minutes: 30,
          category: 'Cabello',
          business_profile_id: 'bp-salon-b-hack' // Intento de inyección ignorado
        });

      expect(res.status).toBe(201);
      expect(res.body.data.business_profile_id).toBe('bp-salon-a');
      expect(res.body.data.business_profile_id).not.toBe('bp-salon-b-hack');

      // El bind debe llevar el tenant del contexto autenticado, nunca el del body.
      const ins = sqlLog.find((e) => /^INSERT INTO services/i.test(e.sql));
      expect(ins).toBeDefined();
      expect(ins.params).toContain('bp-salon-a');
      expect(ins.params).not.toContain('bp-salon-b-hack');
    });
  });
});
