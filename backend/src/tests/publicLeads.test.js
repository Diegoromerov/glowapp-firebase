'use strict';
jest.mock('../config/publicPool', () => ({ connect: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { newDb } = require('pg-mem');
const publicPool = require('../config/publicPool');
const leadsRouter = require('../routes/public/leads');

describe('POST /api/public/leads', () => {
  let app;
  let pgPool;
  let executedStatements;
  const valid = { role: 'client', name: 'Ana', contactType: 'email', contact: 'ANA@example.com', city: 'Bogotá', neighborhood: 'Chapinero', consent: true, consentTextVersion: 'v1', turnstileToken: 'valid-token', website: '', utm: { source: 'test', medium: '', campaign: '' } };

  beforeEach(async () => {
    process.env.TURNSTILE_SECRET = 'test-secret';
    process.env.LANDING_IP_HASH_SALT = 'test-salt';
    process.env.NODE_ENV = 'test';
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    pgPool = new Pool();
    await pgPool.query(`CREATE TABLE landing_leads (
      id serial primary key, role text not null, name text not null, business_name text,
      contact_type text not null, contact_normalized text not null, city text not null,
      neighborhood text, referral_code text, consent boolean not null,
      consent_text_version text not null, consent_at timestamptz not null, utm jsonb not null,
      ip_hash text not null, unique (role, contact_normalized)
    )`);
    executedStatements = [];
    const client = {
      query: async (sql, params) => {
        executedStatements.push(sql);
        if (/^(BEGIN|SET LOCAL ROLE app_system|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
        return pgPool.query(sql, params);
      },
      release: jest.fn(),
    };
    publicPool.connect.mockResolvedValue(client);
    app = express();
    app.use('/api/public', express.json({ limit: '4kb' }));
    app.use('/api/public', leadsRouter);
  });

  afterEach(async () => { await pgPool.end(); });

  test('inserta con consentimiento y hash de IP; un envío duplicado mantiene una sola fila y responde 202', async () => {
    const first = await request(app).post('/api/public/leads').send(valid);
    const second = await request(app).post('/api/public/leads').send(valid);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body).toEqual({ ok: true });
    expect(executedStatements).toContain('SET LOCAL ROLE app_system');
    expect(executedStatements).toContain('COMMIT');
    const inserted = await pgPool.query('SELECT role, contact_normalized, consent, ip_hash FROM landing_leads');
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0]).toMatchObject({ role: 'client', contact_normalized: 'ana@example.com', consent: true });
    expect(inserted.rows[0].ip_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('valida consentimiento, correo, teléfono y campos obligatorios por rol', async () => {
    expect((await request(app).post('/api/public/leads').send({ ...valid, consent: false })).status).toBe(400);
    expect((await request(app).post('/api/public/leads').send({ ...valid, contact: 'no-es-correo' })).status).toBe(400);
    expect((await request(app).post('/api/public/leads').send({ ...valid, contactType: 'whatsapp', contact: 'abc' })).status).toBe(400);
    expect((await request(app).post('/api/public/leads').send({ ...valid, role: 'salon' })).status).toBe(400);
    expect((await request(app).post('/api/public/leads').send({ ...valid, role: 'professional', neighborhood: '' })).status).toBe(400);
    expect(publicPool.connect).not.toHaveBeenCalled();
  });

  test('honeypot responde 202 sin verificar Turnstile ni insertar', async () => {
    const response = await request(app).post('/api/public/leads').send({ ...valid, website: 'spam' });
    expect(response.status).toBe(202);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(publicPool.connect).not.toHaveBeenCalled();
  });

  test('Turnstile fallido da 400; sin TURNSTILE_SECRET da 503 con log de configuración', async () => {
    global.fetch.mockResolvedValueOnce({ json: async () => ({ success: false }) });
    expect((await request(app).post('/api/public/leads').send(valid)).status).toBe(400);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.TURNSTILE_SECRET;
    const response = await request(app).post('/api/public/leads').send(valid);
    expect(response.status).toBe(503);
    expect(errorLog).toHaveBeenCalledWith('[public-leads] configuration_missing', 'TURNSTILE_SECRET');
    expect(publicPool.connect).not.toHaveBeenCalled();
  });

  test('falta de salt responde 503 y no persiste', async () => {
    delete process.env.LANDING_IP_HASH_SALT;
    const response = await request(app).post('/api/public/leads').send(valid);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, error: 'temporarily_unavailable' });
    expect((await pgPool.query('SELECT * FROM landing_leads')).rows).toHaveLength(0);
    expect(publicPool.connect).not.toHaveBeenCalled();
  });

  test('fallo del INSERT responde 503 y no se disfraza como éxito', async () => {
    const client = await publicPool.connect();
    client.query = async (sql, params) => {
      executedStatements.push(sql);
      if (/^(BEGIN|SET LOCAL ROLE app_system|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/^\s*INSERT INTO landing_leads/i.test(sql)) throw new Error('simulated database failure');
      return pgPool.query(sql, params);
    };
    const response = await request(app).post('/api/public/leads').send(valid);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, error: 'temporarily_unavailable' });
    expect((await pgPool.query('SELECT * FROM landing_leads')).rows).toHaveLength(0);
    expect(executedStatements).toContain('SET LOCAL ROLE app_system');
    expect(executedStatements).toContain('ROLLBACK');
  });

  test('cuerpo mayor a 4 KB se rechaza', async () => {
    const response = await request(app).post('/api/public/leads').send({ ...valid, name: 'x'.repeat(5000) });
    expect(response.status).toBe(413);
  });
});
