'use strict';

/**
 * Vista «Prestadores · IVA» del panel admin (fase 4 del plan de captura de la
 * responsabilidad de IVA; hallazgo W13 de .hermes/REVISAR.md).
 *
 * Se monta el router REAL (`adminRoutes`) y se simula SÓLO la identidad
 * (`authMiddleware`): el `adminMiddleware` que decide el 403 es el de verdad, no
 * una copia. Arnés: pg-mem (src/config/pgMemory.js) igual que el resto de pruebas
 * de rutas, compartido con `sequelize` para poder sembrar filas y leerlas por los
 * dos caminos.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

const ADMIN = { id: 1, role: 'admin', email: 'admin@beautyapp.com' };
let mockUsuario = ADMIN;

jest.mock('../middleware/auth', () => {
  const real = jest.requireActual('../middleware/auth');
  return {
    ...real,
    authMiddleware: (req, res, next) => {
      req.user = mockUsuario;
      next();
    },
  };
});

const adminRoutes = require('../routes/adminRoutes');
const { sequelize } = require('../config/database');

const app = express();
app.use(bodyParser.json());
app.use('/api/admin', adminRoutes);

// Ids: 11 sin declarar, 12 declaró el código 48, 13 con override manual.
// El 14 es CLIENTE a propósito: no debe aparecer nunca en la lista.
const sembrar = async () => {
  await sequelize.query('DELETE FROM usuarios');

  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (1, 'Admin Uno', 'admin@beautyapp.com', 'ADMIN', true)`
  );
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (11, 'Ana Sin Declarar', 'ana@test.co', 'PRESTADOR', false)`
  );
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (12, 'Beto Declarado', 'beto@test.co', 'PRESTADOR', true)`
  );
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (13, 'Carla Override', 'carla@test.co', 'PRESTADOR', true)`
  );
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (14, 'Dora Cliente', 'dora@test.co', 'CLIENTE', true)`
  );

  // Beto declaró el 48 (responsable) desde su RUT.
  await sequelize.query(
    `UPDATE usuarios
        SET rut_numero = '901234567-1', rut_responsabilidad_codigo = 48,
            responsabilidad_iva_fuente = 'RUT',
            responsabilidad_iva_actualizada_at = NOW(), responsabilidad_iva_cambiada_por = 12
      WHERE id = 12`
  );

  // A Carla un admin le fijó el valor a mano: manda sobre el RUT (D1).
  await sequelize.query(
    `UPDATE usuarios
        SET responsable_iva_override = true, responsabilidad_iva_fuente = 'MANUAL',
            responsabilidad_iva_actualizada_at = NOW(), responsabilidad_iva_cambiada_por = 1
      WHERE id = 13`
  );
};

beforeEach(async () => {
  mockUsuario = ADMIN;
  await sembrar();
});

const pedir = (query = '') =>
  request(app).get(`/api/admin/providers/fiscal${query}`);

describe('GET /api/admin/providers/fiscal — listado y filtros', () => {
  test('sin filtro devuelve SÓLO prestadores (el CLIENTE no aparece)', async () => {
    const res = await pedir().expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.estado).toBe('todos');
    expect(res.body.prestadores).toHaveLength(3);
    expect(res.body.prestadores.map((p) => p.id).sort((a, b) => a - b)).toEqual([11, 12, 13]);
    expect(res.body.prestadores.some((p) => p.email === 'dora@test.co')).toBe(false);
  });

  test('estado=sin_declarar devuelve sólo a quien no declaró ni tiene override', async () => {
    const res = await pedir('?estado=sin_declarar').expect(200);

    expect(res.body.prestadores).toHaveLength(1);
    expect(res.body.prestadores[0].id).toBe(11);
    expect(res.body.prestadores[0].estado).toBe('SIN_DECLARAR');
    expect(res.body.prestadores[0].rut_numero).toBeNull();
    expect(res.body.prestadores[0].override).toBeNull();
  });

  test('estado=declarado devuelve el derivado del RUT con su código y fuente', async () => {
    const res = await pedir('?estado=declarado').expect(200);

    expect(res.body.prestadores).toHaveLength(1);
    const beto = res.body.prestadores[0];
    expect(beto.id).toBe(12);
    expect(beto.estado).toBe('DECLARADA');
    expect(beto.rut_responsabilidad_codigo).toBe(48);
    expect(beto.fuente).toBe('RUT');
    expect(beto.responsable_iva).toBe(true);
  });

  test('estado=override devuelve el manual, con quién lo cambió', async () => {
    const res = await pedir('?estado=override').expect(200);

    expect(res.body.prestadores).toHaveLength(1);
    const carla = res.body.prestadores[0];
    expect(carla.id).toBe(13);
    expect(carla.estado).toBe('MANUAL');
    expect(carla.override).toBe(true);
    expect(carla.fuente).toBe('MANUAL');
    expect(carla.cambiada_por).toBe(1);
  });

  test('un estado no reconocido responde 400 y enumera los válidos', async () => {
    const res = await pedir('?estado=inventado').expect(400);

    expect(res.body.error).toContain('inventado');
    expect(res.body.estados_validos).toEqual(
      expect.arrayContaining(['todos', 'sin_declarar', 'declarado', 'override'])
    );
  });
});

describe('GET /api/admin/providers/fiscal — el censo no depende del filtro', () => {
  test('el resumen cuenta TODOS los prestadores aunque se filtre', async () => {
    const filtrado = await pedir('?estado=sin_declarar').expect(200);

    // Es la cabecera del panel: si se contara sobre el subconjunto filtrado,
    // diría «1 sin declarar de 1» y ocultaría el alcance real.
    expect(filtrado.body.prestadores).toHaveLength(1);
    expect(filtrado.body.resumen).toEqual({
      total_prestadores: 3,
      declarados: 1,
      sin_declarar: 1,
      override: 1,
    });
  });

  test('el resumen es idéntico con y sin filtro', async () => {
    const sinFiltro = await pedir().expect(200);
    const conFiltro = await pedir('?estado=override').expect(200);

    expect(sinFiltro.body.resumen).toEqual(conFiltro.body.resumen);
  });
});

describe('GET /api/admin/providers/fiscal — autorización', () => {
  test('un prestador recibe 403 (lo decide el adminMiddleware real)', async () => {
    mockUsuario = { id: 11, role: 'PRESTADOR', email: 'ana@test.co' };

    const res = await pedir().expect(403);

    expect(res.body.error).toContain('administrador');
  });

  test('un cliente recibe 403', async () => {
    mockUsuario = { id: 14, role: 'CLIENTE', email: 'dora@test.co' };

    await pedir().expect(403);
  });
});
