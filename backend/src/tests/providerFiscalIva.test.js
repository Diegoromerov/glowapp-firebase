'use strict';

/**
 * Declaración de la responsabilidad de IVA del prestador (W13, D1/D2/D3).
 *
 * Se monta el router REAL (`providerRoutes`) con la autenticación simulada, para
 * probar el cableado de verdad y no una copia de la lógica: el endpoint, la
 * validación, la derivación y el guardia del override.
 *
 * Arnés: pg-mem (src/config/pgMemory.js), igual que el resto de pruebas de rutas.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

const PROVIDER_ID = 7;
const EMAIL_PROVEEDOR = 'prestador-fiscal@test.co';

// Mock de ivaPrestador.reconciliarConDian para tests: DIAN no disponible → cae a RUT
jest.mock('../services/ivaPrestador', () => {
  const actual = jest.requireActual('../services/ivaPrestador');
  return {
    ...actual,
    reconciliarConDian: async ({ codigoDeclarado, override }) => {
      const { resolverResponsabilidadIva } = actual;
      const { responsableIva, fuente } = resolverResponsabilidadIva({ codigo: codigoDeclarado, override });
      return { responsableIva, fuente, codigoOficial: codigoDeclarado, auditoria: { dianDisponible: false } };
    }
  };
});

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 7, role: 'PRESTADOR' };
    next();
  },
}));

const providerRoutes = require('../routes/providerRoutes');
const { sequelize } = require('../config/database');

const app = express();
app.use(bodyParser.json());
app.use('/api', providerRoutes);

/**
 * Deja al prestador como está en producción ANTES de declarar: `responsable_iva`
 * en true por el default de 086 y sin ningún dato fiscal. Así el endpoint tiene
 * que ser el que lo corrija.
 */
const sembrarPrestador = async () => {
  await sequelize.query('DELETE FROM usuarios WHERE id = :id', {
    replacements: { id: PROVIDER_ID },
  });
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (:id, 'Prestador Fiscal', :email, 'PRESTADOR', true)`,
    { replacements: { id: PROVIDER_ID, email: EMAIL_PROVEEDOR } }
  );
};

const filaFiscal = async () => {
  // `sequelize.query` con QueryTypes.SELECT devuelve las filas directamente (no un
  // objeto {rows}); es el mismo contrato que usa bookingController.
  const filas = await sequelize.query(
    `SELECT rut_numero, rut_responsabilidad_codigo, responsable_iva,
            responsable_iva_override, responsabilidad_iva_fuente
       FROM usuarios WHERE id = :id`,
    { replacements: { id: PROVIDER_ID }, type: sequelize.QueryTypes.SELECT }
  );
  return filas[0];
};

beforeEach(async () => {
  await sembrarPrestador();
});

describe('D3 — antes de declarar no se presume responsable', () => {
  test('el estado inicial es SIN_DECLARAR', async () => {
    const res = await request(app).get('/api/provider/fiscal').expect(200);

    expect(res.body.estado).toBe('SIN_DECLARAR');
    expect(res.body.fuente).toBeNull();
    expect(res.body.rut_responsabilidad_codigo).toBeNull();
  });
});

describe('D2 — el número de RUT es obligatorio para declarar', () => {
  test('sin RUT responde 400 y NO toca la base', async () => {
    const res = await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_responsabilidad_codigo: 48 })
      .expect(400);

    expect(res.body.error).toBe('RUT_INVALIDO');
    const fila = await filaFiscal();
    expect(fila.responsabilidad_iva_fuente).toBeNull();
  });

  test('un RUT con formato inválido responde 400', async () => {
    const res = await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: 'ABC', rut_responsabilidad_codigo: 48 })
      .expect(400);

    expect(res.body.error).toBe('RUT_INVALIDO');
  });
});

describe('La casilla de responsabilidades sólo admite 48 o 49', () => {
  test('un código distinto responde 400 y no declara nada', async () => {
    const res = await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '900123456', rut_responsabilidad_codigo: 50 })
      .expect(400);

    expect(res.body.error).toBe('CODIGO_RESPONSABILIDAD_INVALIDO');
    const fila = await filaFiscal();
    expect(fila.rut_responsabilidad_codigo).toBeNull();
  });
});

describe('D1 — el valor se deriva del código del RUT', () => {
  test('código 48 deja al prestador como responsable, con fuente RUT', async () => {
    const res = await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '900.123.456-7', rut_responsabilidad_codigo: 48 })
      .expect(200);

    expect(res.body.fiscal.responsable_iva).toBe(true);
    expect(res.body.fiscal.responsabilidad_iva_fuente).toBe('RUT');

    const fila = await filaFiscal();
    expect(fila.responsable_iva).toBe(true);
    expect(fila.responsabilidad_iva_fuente).toBe('RUT');
    // El RUT se guarda normalizado (sin puntos).
    expect(fila.rut_numero).toBe('900123456-7');
  });

  test('código 49 lo deja como NO responsable: sus reservas no discriminan IVA', async () => {
    await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '1020304050', rut_responsabilidad_codigo: 49 })
      .expect(200);

    const fila = await filaFiscal();
    expect(fila.responsable_iva).toBe(false);
    expect(fila.responsabilidad_iva_fuente).toBe('RUT');
  });

  test('volver a declarar el otro código cambia la responsabilidad (no es pegajosa)', async () => {
    await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '900123456', rut_responsabilidad_codigo: 48 })
      .expect(200);
    await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '900123456', rut_responsabilidad_codigo: 49 })
      .expect(200);

    expect((await filaFiscal()).responsable_iva).toBe(false);
  });
});

describe('D1 — el override manual sólo lo fija un admin', () => {
  test('el prestador NO puede overridear su propia responsabilidad (403)', async () => {
    const res = await request(app)
      .patch('/api/provider/fiscal')
      .send({ rut_numero: '900123456', rut_responsabilidad_codigo: 49, override: true })
      .expect(403);

    expect(res.body.error).toBe('OVERRIDE_REQUIERE_ADMIN');
    // Y no se guarda nada: ni la declaración legítima que venía en el mismo cuerpo.
    const fila = await filaFiscal();
    expect(fila.rut_responsabilidad_codigo).toBeNull();
    expect(fila.responsable_iva_override).toBeNull();
  });
});
