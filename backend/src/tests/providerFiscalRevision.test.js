'use strict';

/**
 * Revisión del RUT del prestador (D-GL-030, fase 1).
 *
 * Se montan los routers REALES (`providerRoutes` y `adminRoutes`) con la
 * autenticación simulada, y se comprueba el ciclo completo sobre pg-mem: el
 * prestador envía el documento, el equipo lo aprueba o rechaza y la publicación
 * queda habilitada sólo al final. Lo que se protege aquí es que nadie publique
 * servicios con un RUT que nadie miró.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

const PROVIDER_ID = 7;
const ADMIN_ID = 1;

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = {
      id: Number(req.headers['x-user-id'] || 7),
      role: req.headers['x-role'] || 'PRESTADOR',
    };
    next();
  },
  adminMiddleware: (req, res, next) => {
    const rol = String(req.user && req.user.role).toUpperCase();
    if (rol === 'ADMIN' || rol === 'SUPERADMIN') return next();
    return res.status(403).json({ error: 'Solo administradores.' });
  },
}));

const providerRoutes = require('../routes/providerRoutes');
const adminRoutes = require('../routes/adminRoutes');
const { sequelize } = require('../config/database');

const app = express();
app.use(bodyParser.json());
app.use('/api', providerRoutes);
app.use('/api/admin', adminRoutes);

const SOPORTE = {
  soporte_url: 'https://storage.example.com/rut/1020304050.pdf',
  soporte_hash: 'b'.repeat(64),
  mime: 'application/pdf',
  bytes: 180000,
};

async function sembrar() {
  await sequelize.query('DELETE FROM usuarios WHERE id IN (:ids)', {
    replacements: { ids: [PROVIDER_ID, ADMIN_ID] },
  });
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol)
     VALUES (:adminId, 'Revisora', 'revisora@test.co', 'ADMIN')`,
    { replacements: { adminId: ADMIN_ID } }
  );
  await sequelize.query(
    `INSERT INTO usuarios (id, nombre, email, rol, responsable_iva)
     VALUES (:id, 'Prestador RUT', 'prestador-rut@test.co', 'PRESTADOR', true)`,
    { replacements: { id: PROVIDER_ID } }
  );
}

async function filaFiscal() {
  const filas = await sequelize.query(
    `SELECT rut_numero, rut_responsabilidad_codigo, responsable_iva,
            revision_estado, revision_nota, revisado_por, rut_soporte_url
       FROM usuarios WHERE id = :id`,
    { replacements: { id: PROVIDER_ID }, type: sequelize.QueryTypes.SELECT }
  );
  return filas[0];
}

const enviarRut = (cuerpo = {}) =>
  request(app)
    .post('/api/provider/fiscal/rut')
    .send({
      rut_numero: '1020304050',
      rut_responsabilidad_codigo: 49,
      ...SOPORTE,
      ...cuerpo,
    });

const revisar = (accion, extra = {}) =>
  request(app)
    .post(`/api/admin/providers/${PROVIDER_ID}/fiscal/revision`)
    .set('x-user-id', String(ADMIN_ID))
    .set('x-role', 'ADMIN')
    .send({ accion, ...extra });

beforeEach(sembrar);

describe('envío del RUT', () => {
  test('sin soporte no se acepta la declaración', async () => {
    const res = await enviarRut({ soporte_hash: '' }).expect(400);
    expect(res.body.error).toBe('SOPORTE_INVALIDO');
    const fila = await filaFiscal();
    expect(fila.revision_estado).toBe('SIN_ENVIAR');
  });

  test('con soporte válido el documento queda en la cola', async () => {
    const res = await enviarRut().expect(202);

    expect(res.body.revision.estado).toBe('PENDIENTE');
    expect(res.body.puede_publicar_servicios).toBe(false);

    const fila = await filaFiscal();
    expect(fila.revision_estado).toBe('PENDIENTE');
    expect(fila.rut_soporte_url).toBe(SOPORTE.soporte_url);
    // Nada de aplicar IVA antes de que alguien mire el documento.
    expect(fila.responsable_iva).toBe(true);
  });

  test('mientras está en revisión el prestador no publica', async () => {
    await enviarRut().expect(202);

    const res = await request(app).get('/api/provider/fiscal').expect(200);
    expect(res.body.revision.estado).toBe('PENDIENTE');
    expect(res.body.puede_publicar_servicios).toBe(false);
    expect(res.body.motivo_publicacion).toBe('EN_REVISION');
  });

  test('no se puede reenviar un RUT que ya está en revisión', async () => {
    await enviarRut().expect(202);
    const res = await enviarRut().expect(409);
    expect(res.body.error).toBe('TRANSICION_INVALIDA');
  });
});

describe('revisión del equipo', () => {
  test('aprobar aplica el código 49 del RUT: no responsable de IVA', async () => {
    await enviarRut({ rut_responsabilidad_codigo: 49 }).expect(202);

    const res = await revisar('APROBAR').expect(200);
    expect(res.body.revision.estado).toBe('APROBADA');
    expect(res.body.revision.responsable_iva).toBe(false);

    const fiscal = await request(app).get('/api/provider/fiscal').expect(200);
    expect(fiscal.body.puede_publicar_servicios).toBe(true);
    expect(fiscal.body.motivo_publicacion).toBe('APROBADA');
    expect(fiscal.body.responsable_iva).toBe(false);
  });

  test('aprobar aplica el código 48: responsable de IVA', async () => {
    await enviarRut({ rut_responsabilidad_codigo: 48 }).expect(202);
    await revisar('APROBAR').expect(200);

    const fiscal = await request(app).get('/api/provider/fiscal').expect(200);
    expect(fiscal.body.responsable_iva).toBe(true);
    expect(fiscal.body.puede_publicar_servicios).toBe(true);
  });

  test('rechazar exige motivo y deja al prestador bloqueado', async () => {
    await enviarRut().expect(202);

    await revisar('RECHAZAR').expect(409);

    const conNota = await revisar('RECHAZAR', { nota: 'El RUT está vencido.' }).expect(200);
    expect(conNota.body.revision.estado).toBe('RECHAZADA');
    expect(conNota.body.revision.nota).toBe('El RUT está vencido.');

    const fiscal = await request(app).get('/api/provider/fiscal').expect(200);
    expect(fiscal.body.puede_publicar_servicios).toBe(false);
    expect(fiscal.body.motivo_publicacion).toBe('RECHAZADA');
    expect(fiscal.body.revision.nota).toBe('El RUT está vencido.');
  });

  test('tras el rechazo el prestador puede corregir y reenviar', async () => {
    await enviarRut().expect(202);
    await revisar('RECHAZAR', { nota: 'Ilegible.' }).expect(200);

    const reenvio = await enviarRut({ mime: 'image/jpeg' }).expect(202);
    expect(reenvio.body.revision.estado).toBe('PENDIENTE');
  });

  test('no se aprueba algo que nadie envió', async () => {
    const res = await revisar('APROBAR').expect(409);
    expect(res.body.error).toBe('TRANSICION_INVALIDA');
  });

  test('un no-admin no puede revisar', async () => {
    await enviarRut().expect(202);

    await request(app)
      .post(`/api/admin/providers/${PROVIDER_ID}/fiscal/revision`)
      .set('x-user-id', '7')
      .set('x-role', 'PRESTADOR')
      .send({ accion: 'APROBAR' })
      .expect(403);
  });
});

describe('cola del equipo', () => {
  test('el filtro por revisión devuelve el prestador pendiente', async () => {
    await enviarRut().expect(202);

    const res = await request(app)
      .get('/api/admin/providers/fiscal?revision=pendiente')
      .set('x-user-id', String(ADMIN_ID))
      .set('x-role', 'ADMIN')
      .expect(200);

    expect(res.body.revision).toBe('pendiente');
    expect(res.body.prestadores).toHaveLength(1);
    expect(res.body.prestadores[0].revision_estado).toBe('PENDIENTE');
    expect(res.body.resumen.revision.pendiente).toBe(1);
  });

  test('un filtro de revisión desconocido responde 400', async () => {
    const res = await request(app)
      .get('/api/admin/providers/fiscal?revision=inventada')
      .set('x-user-id', String(ADMIN_ID))
      .set('x-role', 'ADMIN')
      .expect(400);

    expect(res.body.revisiones_validas).toContain('pendiente');
  });

  test('con el RUT aprobado el prestador sale de la cola', async () => {
    await enviarRut().expect(202);
    await revisar('APROBAR').expect(200);

    const res = await request(app)
      .get('/api/admin/providers/fiscal?revision=pendiente')
      .set('x-user-id', String(ADMIN_ID))
      .set('x-role', 'ADMIN')
      .expect(200);

    expect(res.body.prestadores).toHaveLength(0);
    expect(res.body.resumen.revision.aprobada).toBe(1);
  });
});
