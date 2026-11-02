const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('ORDEN A O-014 — Cargo 2: Regla de Frescura R4 en estadoKB.js', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const partesDir = path.join(rootDir, 'docs/agents/partes');
  const tempParteDir = path.join(rootDir, 'docs/agents/partes_temp_backup');

  beforeEach(() => {
    if (fs.existsSync(tempParteDir)) {
      fs.rmSync(tempParteDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Restaurar directorio de partes si fue movido
    if (fs.existsSync(tempParteDir)) {
      if (fs.existsSync(partesDir)) {
        fs.rmSync(partesDir, { recursive: true, force: true });
      }
      fs.renameSync(tempParteDir, partesDir);
    }
  });

  test('(a) Sin parte reciente en los últimos 14 días, estadoKB.js --check falla (exit 1) reportando R4', () => {
    // Mover temporalmente los partes existentes
    if (fs.existsSync(partesDir)) {
      fs.renameSync(partesDir, tempParteDir);
    }
    fs.mkdirSync(partesDir, { recursive: true });

    // Ejecutar estadoKB.js --check
    const res = spawnSync('node', ['backend/scripts/estadoKB.js', '--check'], { cwd: rootDir, encoding: 'utf8', env: { ...process.env, GUARDIAN_SKIP_NETWORK: '1' } });

    expect(res.status).toBe(1);
    expect(res.stderr + res.stdout).toContain('R4');
    expect(res.stderr + res.stdout).toContain('docs/agents/partes/');
  });

  test('(b) Con parte reciente en los últimos 14 días, la regla R4 no se activa', () => {
    // Asegurar que existe parte-2026-09-25.md en partesDir
    const parteFile = path.join(partesDir, 'parte-2026-09-25.md');
    expect(fs.existsSync(parteFile)).toBe(true);

    const res = spawnSync('node', ['backend/scripts/estadoKB.js'], { cwd: rootDir, encoding: 'utf8', env: { ...process.env, GUARDIAN_SKIP_NETWORK: '1' } });

    const output = res.stdout + res.stderr;
    expect(output).not.toContain('«docs/agents/partes/» no tiene ningún parte');
  });
});
