const test = require('node:test');
const assert = require('node:assert/strict');
const adminAuditRepository = require('../repositories/adminAuditRepository');
const { buildAuditRecord, clientIp, resolveAction } = require('../middleware/adminAuditLog');

test('T-A2 Admin Audit Log & Repository Suite', async (t) => {
  await t.test('buildAuditRecord builds complete record from request context', () => {
    const mockReq = {
      user: { id: 'admin-123', email: 'admin@glowapp.com' },
      params: { id: 'disp-456' },
      method: 'PATCH',
      originalUrl: '/api/admin/disputes/disp-456/resolve',
      ip: '192.168.1.50',
      headers: { 'user-agent': 'GlowAdmin/2.0' },
    };
    const mockRes = { statusCode: 200 };

    const record = buildAuditRecord(mockReq, mockRes, { action: 'dispute.resolve', resource: 'dispute' });

    assert.strictEqual(record.user_id, 'admin-123');
    assert.strictEqual(record.action, 'dispute.resolve');
    assert.strictEqual(record.resource, 'dispute');
    assert.strictEqual(record.resource_id, 'disp-456');
    assert.strictEqual(record.method, 'PATCH');
    assert.strictEqual(record.path, '/api/admin/disputes/disp-456/resolve');
    assert.strictEqual(record.status_code, 200);
    assert.strictEqual(record.ip, '192.168.1.50');
    assert.strictEqual(record.user_agent, 'GlowAdmin/2.0');
    assert.ok(record.timestamp);
  });

  await t.test('clientIp extracts forwarded IP headers properly', () => {
    const mockReq = {
      headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' }
    };
    assert.strictEqual(clientIp(mockReq), '203.0.113.195');
  });

  await t.test('insertAdminAuditLog & listAdminAuditLogs persist and retrieve logs append-only', async () => {
    process.env.NODE_ENV = 'test';

    const testRecord = {
      user_id: 'admin-999',
      action: 'precios.import_csv',
      resource: 'precios',
      resource_id: 'batch-2026',
      method: 'POST',
      path: '/api/admin/precios/import.csv',
      status_code: 200,
      ip: '10.0.0.1',
      user_agent: 'NodeTest/1.0',
      metadata: { rowsProcessed: 15 }
    };

    const inserted = await adminAuditRepository.insertAdminAuditLog(testRecord);
    assert.ok(inserted);
    assert.strictEqual(inserted.user_id, 'admin-999');
    assert.strictEqual(inserted.action, 'precios.import_csv');

    const logs = await adminAuditRepository.listAdminAuditLogs({
      userId: 'admin-999',
      action: 'precios.import_csv'
    });

    assert.ok(Array.isArray(logs));
    assert.ok(logs.length >= 1);
    const found = logs.find(l => l.user_id === 'admin-999' && l.action === 'precios.import_csv');
    assert.ok(found);
    assert.strictEqual(found.resource, 'precios');
  });
});
