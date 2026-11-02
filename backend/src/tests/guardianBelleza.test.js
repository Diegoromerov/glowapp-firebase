const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('ORDEN A O-014 Ronda 8 — Cargo 1 & Cargo 2: guardianBelleza.sh Real Execution & GUARDIAN_REPO', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const scriptPath = path.join(rootDir, 'backend/scripts/guardianBelleza.sh');
  const tmpDir = path.join(rootDir, 'backend/src/tests/tmp_mocks');

  const bashCmd = process.platform === 'win32'
    ? (fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash')
    : 'bash';

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('(1) Ejecución REAL del chequeo sin mock (sin ESTADO_KB_SCRIPT) resuelve la ruta nativa', () => {
    const env = { ...process.env, GUARDIAN_SKIP_NETWORK: '1' };
    delete env.ESTADO_KB_SCRIPT;

    const res = spawnSync(bashCmd, [scriptPath], { cwd: rootDir, encoding: 'utf8', env });

    // Verificar que el runner invocó estadoKB.js sin fallar por MODULE_NOT_FOUND y convirtió a ruta nativa
    expect(res.stdout).not.toContain("Cannot find module");
    expect(res.stdout).toContain("== guardián estadoKB --check ==");
    expect(res.stdout).toMatch(/ruta: ([A-Za-z]:[/\\]|\/)/);
  });

  test('(2) Soporte de GUARDIAN_REPO personalizable', () => {
    const customRepoDir = path.join(rootDir, 'docs', 'agents');
    const env = { ...process.env, GUARDIAN_REPO: customRepoDir, GUARDIAN_SKIP_NETWORK: '1' };
    delete env.ESTADO_KB_SCRIPT;

    const res = spawnSync(bashCmd, [scriptPath], { cwd: rootDir, encoding: 'utf8', env });

    expect(res.stdout).toContain("copia inspeccionada");
    expect(res.stdout).toMatch(/ruta: .*docs[/\\]agents/);
  });

  test('(3) Con estadoKB.js simulado que sale exit 1, guardianBelleza.sh termina con exit != 0', () => {
    const mockFailScript = path.join(tmpDir, 'mockFail.js');
    fs.writeFileSync(mockFailScript, 'console.error("Mock Fail"); process.exit(1);', 'utf8');

    const res = spawnSync(bashCmd, [scriptPath], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, ESTADO_KB_SCRIPT: mockFailScript, GUARDIAN_SKIP_NETWORK: '1' }
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('exit=1');
  });

  test('(4) Con estadoKB.js ausente, guardianBelleza.sh emite NO DISPONIBLE y termina con exit != 0', () => {
    const nonExistentScript = path.join(tmpDir, 'nonExistent.js');

    const res = spawnSync(bashCmd, [scriptPath], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, ESTADO_KB_SCRIPT: nonExistentScript, GUARDIAN_SKIP_NETWORK: '1' }
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('NO DISPONIBLE');
    expect(res.stdout).toContain('exit=no-disponible');
  });

  test('(5) Caso sin red GUARDIAN_SKIP_NETWORK=1 omite consultas externas', () => {
    const mockOkScript = path.join(tmpDir, 'mockOk.js');
    fs.writeFileSync(mockOkScript, 'console.log("Mock OK"); process.exit(0);', 'utf8');

    const res = spawnSync(bashCmd, [scriptPath], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, ESTADO_KB_SCRIPT: mockOkScript, GUARDIAN_SKIP_NETWORK: '1' }
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('NO VERIFICADO (omitido en tests)');
  });
});
