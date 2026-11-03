/**
 * backend/src/tests/composeProdSecretsRequired.test.js
 * FASE C — Fix P0 INFRA #2 (hallazgo: password por defecto `changeme_en_despliegue`).
 *
 * Contrato que se exige, en este orden:
 *   1. `docker-compose.prod.yml` NO puede traer un valor por defecto literal para una
 *      variable sensible: en producción, un `:-` se convierte en la contraseña viva.
 *   2. La variable sensible de PostgreSQL debe declararse OBLIGATORIA (`:?`), de modo
 *      que el despliegue aborte con mensaje legible si falta, en vez de arrancar con
 *      una credencial conocida por cualquiera que lea el repo.
 *   3. El escáner bloqueante de CI (`backend/scripts/verifyNoVersionedSecrets.js`)
 *      tiene que marcar la línea histórica exacta. Hoy NO la marca: por eso el
 *      hallazgo sobrevivió a la compuerta. Esta prueba fija esa regresión.
 *
 * Ficha: se escribió ANTES del fix (rojo) y sólo después se cambió el compose y el escáner.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.prod.yml');
const SCANNER_PATH = path.resolve(__dirname, '../../scripts/verifyNoVersionedSecrets.js');

const { analizarSalida } = require('../../scripts/verifyNoVersionedSecrets');

const SENSITIVE = /(PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)/i;
const METADATA_SUFFIX = /_(HEADER|NAME|FIELD|TYPE|ALGO|SCOPE|PARAM)$/i;
// Interpolación estilo compose:  ${VAR:-valor_por_defecto}
const COMPOSE_DEFAULT = /\$\{([A-Za-z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*):-([^}]*)\}/gi;

function leerCompose() {
  return fs.readFileSync(COMPOSE_PATH, 'utf8');
}

/** Devuelve los defectos `VAR:-literal` de un contenido (default no vacío y sensible). */
function defectosDeValorPorDefecto(contenido) {
  const defectos = [];
  contenido.split(/\r?\n/).forEach((linea, i) => {
    const re = new RegExp(COMPOSE_DEFAULT.source, 'gi');
    let m;
    while ((m = re.exec(linea)) !== null) {
      const [, variable, valor] = m;
      if (METADATA_SUFFIX.test(variable)) continue;
      if (valor === '') continue; // `${X:-}` no aporta credencial
      defectos.push({ linea: i + 1, variable, valor });
    }
  });
  return defectos;
}

describe('FASE C / P0 INFRA #2 — el compose de producción no trae credenciales por defecto', () => {
  test('1. POSTGRES_PASSWORD se declara OBLIGATORIA (interpolación `:?`), no con default literal', () => {
    const compose = leerCompose();
    const linea = compose.split(/\r?\n/).find((l) => /POSTGRES_PASSWORD/.test(l) && !/^\s*#/.test(l));

    expect(linea).toBeDefined();
    // Debe exigir la variable: `${POSTGRES_PASSWORD:?mensaje}`
    expect(linea).toMatch(/\$\{POSTGRES_PASSWORD:\?[^}]*\}/);
    // Y no puede quedar ningún default literal para el password.
    expect(linea).not.toMatch(/\$\{POSTGRES_PASSWORD:-/);
  });

  test('2. Ninguna variable sensible del compose de producción tiene valor por defecto literal', () => {
    const defectos = defectosDeValorPorDefecto(leerCompose());
    expect(defectos).toEqual([]);
  });

  test('3. Regresión: el escáner de CI marca la línea histórica `changeme_en_despliegue`', () => {
    const lineaHistorica =
      'docker-compose.prod.yml:32:      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme_en_despliegue}';
    const { hallazgos, exitCode } = analizarSalida(`${lineaHistorica}\n`);

    expect(exitCode).toBe(1);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toEqual({
      archivo: 'docker-compose.prod.yml',
      numLinea: '32',
      nombre: 'valor por defecto literal en interpolación de compose',
    });
  });

  test('4. Control negativo: el escáner NO marca defaults vacíos ni variables no sensibles', () => {
    const benignas = [
      'railway.yml:48:        value: ${FAL_KEY:-}',
      'frontend/Dockerfile:24:CMD ["/bin/sh", "-c", "${PORT:-8080}"]',
      'backend/scripts/guardianBelleza.sh:26:TARGET_REPO="${GUARDIAN_REPO:-$DEFAULT_ROOT_DIR}"',
    ];
    for (const linea of benignas) {
      const { hallazgos } = analizarSalida(`${linea}\n`);
      expect(hallazgos).toEqual([]);
    }
  });

  test('5. End-to-end: el escáner bloqueante de CI sale en verde sobre el árbol real', () => {
    const stdout = execFileSync('node', [SCANNER_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(stdout).toContain('Sin credenciales versionadas');
  });
});
