'use strict';

const fs = require('fs');
const path = require('path');

describe('migración 179: metadata de preferencias de notificación', () => {
  const backend = path.join(__dirname, '..');
  const migration = fs.readFileSync(
    path.join(backend, 'migrations/179_add_notification_prefs_metadata.sql'),
    'utf8'
  );
  const runner = fs.readFileSync(
    path.join(backend, 'scripts/prepareRlsDatabase.js'),
    'utf8'
  );
  const controller = fs.readFileSync(
    path.join(backend, 'src/controllers/notificationPrefsController.js'),
    'utf8'
  );

  test('agrega la columna de forma idempotente y conserva filas existentes', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(migration).not.toMatch(/DROP\s+COLUMN|DELETE\s+FROM/i);
  });

  test('se aplica tanto en bases nuevas como en bases ya inicializadas', () => {
    expect(runner.match(/'179_add_notification_prefs_metadata\.sql'/g)).toHaveLength(2);
  });

  test('la columna existe para las lecturas y escrituras de la API', () => {
    expect(controller).toMatch(/SELECT evento_tipo, canal, habilitado, metadata/);
    expect(controller).toMatch(/usuario_notificaciones_prefs \(usuario_id, evento_tipo, canal, habilitado, metadata\)/);
  });
});
