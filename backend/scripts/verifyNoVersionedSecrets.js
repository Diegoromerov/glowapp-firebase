#!/usr/bin/env node
/**
 * verifyNoVersionedSecrets.js
 * A360-2026-09-22/C-02 — Falla si hay credenciales reales en archivos TRACKEADOS.
 * WO B-02 — Reglas extendidas para valores literales por defecto en vars sensibles y tokens en URL.
 * ORDEN A-06 — Normalización CRLF/LF, acotamiento de alcance (código ejecutable) y compuerta pura exportada.
 * N-10 — Regla 8: literales de contraseña EN TEXTO PLANO versionados (`password: 'Demo123456'`,
 *        `RAISE NOTICE 'Password: …'`, `console.log('   Password: …')`, `// password123`).
 *
 * Sin dependencias externas: usa `git grep` sobre el índice/árbol de trabajo.
 * Nunca imprime el valor del secreto, solo archivo:línea y el tipo de patrón.
 *
 * Uso:  node backend/scripts/verifyNoVersionedSecrets.js
 * CI:   agregado como paso bloqueante en .github/workflows/ci.yml
 */
const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const ALLOW_MARKERS = /(PLACEHOLDER|REPLACE_ME|__SEED_PASSWORD_HASH__|YOUR_|TU_|REDACTED|\*\*\*|\.\.\.|xxxx|XXXX|dummy|example\.com|<[^>]+>)/;

const NON_SECRET_SUFFIXES = /_(HEADER|NAME|FIELD|TYPE|ALGO|SCOPE|PARAM)$/i;
const TECHNICAL_VOCAB = /^(authorization|bearer|x-api-key|hs256|rs256|es256|basic|password_hash|jwt_secret|glow_token)$/i;
const WEAK_PASSWORDS = new Set(['postgres', 'admin', 'admin123', 'password', 'password123', '123456', 'demo', 'test1234', 'root']);

// Regla 8 (N-10): nombres/tipos que NUNCA son una contraseña aunque aparezcan a la derecha de `clave:`.
const NON_PASSWORD_VALUES = new Set([
  'password', 'passwd', 'pwd', 'contrasena', 'contraseña', 'password_hash', 'hash',
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'void',
  'undefined', 'null', 'true', 'false', 'secret', 'token', 'credentials',
]);

// `bcryptjs` sólo se usa para verificar hashes débiles conocidos. Sin la dependencia instalada
// (p. ej. un árbol sin `npm ci`) la verificación no puede afirmarse: la regla se saltea en vez de
// tumbar la compuerta con un MODULE_NOT_FOUND.
let bcryptCache;
function cargarBcrypt() {
  if (bcryptCache === undefined) {
    try {
      bcryptCache = require('bcryptjs');
    } catch (_) {
      bcryptCache = null;
      console.warn('⚠️  bcryptjs ausente: la verificación de hashes de contraseña débil conocida queda desactivada (ejecutar `npm ci`).');
    }
  }
  return bcryptCache;
}

const REGLAS = [
  {
    nombre: 'cadena de conexión con contraseña',
    buscar: 'postgres(ql)?://[^:"\'[:space:]]+:[^@"\'[:space:]]+@',
    validar: (linea, archivo) => {
      if (archivo && /\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      const re = /postgres(?:ql)?:\/\/([^:\s"'`<>]+):([^@\s"'`<>]+)@/g;
      let m;
      while ((m = re.exec(linea)) !== null) {
        const pw = m[2];
        if (pw !== '***' && !ALLOW_MARKERS.test(pw) && !/^(%|REDACTED|\$|\$\{|<|YOUR|TU_|password|pass|changeme|postgres|admin|admin123|root|ci_only_password)/i.test(pw)) return true;
      }
      return false;
    },
  },
  {
    nombre: 'clave NVIDIA',
    buscar: 'nvapi-[A-Za-z0-9_-]{10,}',
    validar: (linea) => {
      const m = linea.match(/nvapi-[A-Za-z0-9_-]{10,}/);
      return m ? !ALLOW_MARKERS.test(m[0]) : false;
    }
  },
  {
    nombre: 'clave tipo OpenAI',
    buscar: '(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}',
    validar: (linea) => {
      const m = linea.match(/sk-[A-Za-z0-9_-]{24,}/);
      return m ? !ALLOW_MARKERS.test(m[0]) : false;
    }
  },
  {
    nombre: 'clave tipo Google API',
    buscar: '(^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{30,}',
    validar: (linea) => {
      const m = linea.match(/AIza[A-Za-z0-9_-]{30,}/);
      return m ? !ALLOW_MARKERS.test(m[0]) : false;
    }
  },
  {
    nombre: 'clave privada PEM',
    buscar: '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    validar: (linea) => /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(linea) && !ALLOW_MARKERS.test(linea)
  },
  {
    nombre: 'token de Slack/GitHub',
    buscar: '(xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{30,})',
    validar: (linea) => {
      const m = linea.match(/(xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{30,})/);
      return m ? !ALLOW_MARKERS.test(m[0]) : false;
    }
  },
  {
    nombre: 'valor por defecto literal para variable sensible',
    buscar: '(PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*[[:space:]]*(:|=|\\|\\||\\?\\?)[[:space:]]*',
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;
      if (/^\s*(\/\/|\/\*|\*|#)/.test(linea.trim())) return false;
      if (/^\s*(console\.(log|info|warn|error)|logger\.(log|info|warn|error))\b/.test(linea.trim())) return false;

      const patterns = [
        /(?:process\.env\.)?([A-Za-z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*)\s*(?:\|\||\?\?)\s*(?:['"]([^'"]+)['"]|([^\s#;,]+))/gi,
        /(?:const|let|var|this\.)?\s*([A-Za-z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*)\s*(?::|=)\s*(?:['"]([^'"]+)['"]|([^\s#;,]+))/gi
      ];

      for (let patternIdx = 0; patternIdx < patterns.length; patternIdx++) {
        const re = patterns[patternIdx];
        let m;
        while ((m = re.exec(linea)) !== null) {
          const varName = m[1] || '';
          const val = (m[2] !== undefined ? m[2] : m[3]) || '';
          if (!val || val.length < 4) continue;
          if (val.startsWith('$') || val.startsWith('${') || val.includes('${') || /^process\.env\./i.test(val) || /^env\./i.test(val)) continue;
          if (val.includes('(') || val.includes(')') || /^crypto\./i.test(val) || /^Buffer\./i.test(val)) continue;
          if (m[2] === undefined && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(val)) continue;
          if (/^(\*\*\*|REDACTED|TU_|YOUR_|changeme|PLACEHOLDER|xxx|example|dummy|REPLACE_ME)/i.test(val)) continue;
          if (ALLOW_MARKERS.test(val)) continue;

          // --- FILTROS DE FALSOS POSITIVOS (CI-52 / CI-52 bis) ---
          // 1. Sufijos de metadatos/descriptores (sacrificio aceptado CI-52: API_KEY_NAME = 'sk-live-...' no se detecta)
          if (NON_SECRET_SUFFIXES.test(varName)) continue;

          // 2. Vocabulario técnico conocido
          if (TECHNICAL_VOCAB.test(val)) continue;

          // 3. Filtro de baja entropía: se aplica únicamente a asignación directa (patternIdx === 1).
          // En fallback (patternIdx === 0, ||/??), cualquier literal es defecto (CI-52 bis).
          // Sacrificio aceptado (CI-52): X_PASSWORD = 'letmein' (asignación directa de baja entropía) no se detecta.
          if (patternIdx === 1 && !WEAK_PASSWORDS.has(val.toLowerCase()) && /^[a-z_]+$/.test(val) && val.length < 12) continue;

          return true;
        }
      }
      return false;
    }
  },
  {
    // FASE C / P0 INFRA #2 — El `:-` de la interpolación de compose no lo veían las reglas
    // anteriores: el `$` inicial hace que «valor por defecto literal» lo descarte como
    // referencia, y `changeme…` estaba en la lista de marcadores benignos. Pero en un
    // docker-compose de producción el `:-` NO es un marcador: pasa a ser la credencial
    // viva del contenedor si la variable no llega. Aquí no se exime `changeme`.
    nombre: 'valor por defecto literal en interpolación de compose',
    buscar: '\\$\\{[A-Za-z0-9_]*(PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*:-',
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;
      if (/^\s*(\/\/|\/\*|\*|#)/.test(linea.trim())) return false;

      const re = /\$\{([A-Za-z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*):-([^}]*)\}/g;
      let m;
      while ((m = re.exec(linea)) !== null) {
        const varName = m[1];
        const valorPorDefecto = m[2];
        if (NON_SECRET_SUFFIXES.test(varName)) continue;
        if (valorPorDefecto === '') continue; // `${X:-}` no aporta credencial
        if (/^(\$|<)/.test(valorPorDefecto)) continue; // referencia a otra variable o marcador
        if (/^(\*{2,}|REDACTED|\.\.\.|PLACEHOLDER|REPLACE_ME|dummy|xxx+)$/i.test(valorPorDefecto)) continue;
        return true;
      }
      return false;
    },
  },
  {
    nombre: 'token o JWT en parámetro de URL',
    buscar: '[?&]token=',
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/^docs\/.*\.md$/i.test(archivo)) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;
      if (/^\s*(\/\/|\/\*|\*|#)/.test(linea.trim())) return false;
      if (ALLOW_MARKERS.test(linea) || /<[^>]+>|\$\{[^}]+\}/.test(linea)) return false;
      return true;
    }
  },
  {
    nombre: 'contraseña documentada en prosa o comentario',
    buscar: '(contrase[a-zñ]*|password|clave)[[:space:]]+.*:[[:space:]]*',
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/^docs\//i.test(archivo)) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;
      const trimmed = linea.trim();
      if (/^\s*(console\.(log|info|warn|error)|logger\.(log|info|warn|error)|res\.status|return res|throw new)\b/.test(trimmed)) return false;
      const re = /(?:contraseñ[a-z]*|contrasena|password)\b[^\n:]{0,40}\b(?:es|is|para|for|todos|all|defecto|predeterminada)\b[^\n:]{0,20}:\s*([^\s;,"]+)/gi;
      let m;
      while ((m = re.exec(linea)) !== null) {
        const val = m[1];
        if (!val || val.length < 3) continue;
        if (ALLOW_MARKERS.test(val)) continue;
        if (/^(\$|\$\{|<|YOUR|TU_|PLACEHOLDER|REDACTED|\*\*\*|\.\.\.)/i.test(val)) continue;
        return true;
      }
      return false;
    }
  },
  {
    // N-2 (t_fix_tenant_08) — Compuerta ENDURECIDA.
    // Antes: el `buscar` usaba `\d`, que POSIX ERE (`git grep -E`) NO interpreta como dígito,
    // así que la regla nunca seleccionaba una línea y era una compuerta muerta. Además exigía
    // exactamente 53 caracteres y comparaba contra bcryptjs (dependencia de instalación) para
    // decidir si la contraseña era "débil conocida".
    // Ahora: detección ESTÁTICA (sin bcryptjs) de cualquier hash bcrypt versionado —$2a$/$2b$/$2y$—,
    // que es el defecto real: versionar un hash permite crackearlo offline. Se admiten hashes
    // recortados (>= 40 caracteres tras el prefijo) porque también son material de credencial.
    nombre: 'hash bcrypt versionado',
    buscar: '\\$2[aby]\\$[0-9]{2}\\$[A-Za-z0-9./]{40,}',
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;
      // N-15: resuelto en la integración Fase D. Se conserva la regla ESTÁTICA de
      // t_fix_tenant_08 (`[0-9]`, >= 40 chars, sin bcryptjs). La variante de t_fix_tenant_10
      // usaba `\d` + exactamente 53 chars + guard de bcryptjs: `\d` NO es dígito en POSIX ERE
      // de `git grep -E`, así que esa versión volvía a dejar la regla ciega (0 líneas).
      const re = /\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{40,}/g;
      let m;
      while ((m = re.exec(linea)) !== null) {
        if (ALLOW_MARKERS.test(m[0])) continue;
        return true;
      }
      return false;
    }
  },
  {
    /**
     * N-10 — contraseñas EN TEXTO PLANO versionadas.
     *
     * El corpus traía literales de contraseña con forma `clave[:=]valor` y también anunciados en
     * prosa/comentario, y ninguna regla los seleccionaba: Rule 7 exige nombres de variable en
     * MAYÚSCULAS (`DB_PASSWORD=…`) y la regla de prosa exige `… es/is …` antes de los dos puntos.
     *
     * Alcance (para no inundar de falsos positivos): se acepta una línea solo si
     *   (a) publica la contraseña en un comentario pegado a la palabra clave — `// password123`;
     *   (b) o el valor a la derecha de `clave[:=]` es un LITERAL: entrecomillado (cualquiera), o
     *       suelto pero con letra Y dígito (una referencia de código —`process.env.X`, `data.password`,
     *       `string`, `await`, `fixtureAdminPassword`— no tiene esa forma).
     * Sacrificio aceptado (documentado, como CI-52): `password: letmein` suelto sin dígito no se marca.
     *
     * Nota de implementación: la palabra clave usa la raíz `[Cc]ontrase` (no `[Cc]ontrase[ñn]a`)
     * porque `git grep -E` es orientado a bytes: una clase con `ñ` no casa el carácter UTF-8 de
     * «Contraseña» (verificado: `Contrase` sí, `[Cc]ontrase[ñn]a` no).
     */
    nombre: 'contraseña en texto plano (literal versionado)',
    buscar: "([Cc]ontrase|[Pp]assword|[Pp]asswd|[Pp]wd)[^:=\"',;}]{0,40}[:=][[:space:]]*|(//|--|#)[[:space:]]*([Cc]ontrase|[Pp]assword|[Pp]asswd|[Pp]wd)[0-9]",
    validar: (linea, archivo) => {
      if (!archivo) return false;
      if (/\.(test|spec)\.[jt]sx?$/.test(archivo)) return false;
      if (/scripts\/verify/.test(archivo)) return false;

      // (a) comentario que publica la contraseña en la misma línea: `// password123`
      if (/(?:\/\/|--|#)\s*(?:[Cc]ontrase|[Pp]assword|[Pp]asswd|[Pp]wd)[0-9]/.test(linea)) return true;

      // El hueco entre la palabra clave y el separador no puede cruzar `;`, comillas, comas ni
      // llaves: sin esto, la clave de `$testPassword … ; role = "client"` engancha un `=` ajeno y
      // marca «client» como contraseña.
      const base = "(?:[Cc]ontrase|[Pp]assword|[Pp]asswd|[Pp]wd)[^:=\"',;}]{0,40}[:=][ \\t]*";

      const sospechoso = (val, exigeDigito, esSuelto) => {
        if (!val || val.length < 4) return false;
        // Sólo una palabra suelta puede ser una contraseña literal: `process.env.X`, `data.password`,
        // `params[2]`, `<...>`, `${...}` y cualquier expresión de código quedan fuera por construcción.
        if (!/^[A-Za-z0-9_-]+$/.test(val)) return false;
        if (!/[A-Za-z]/.test(val)) return false;
        if (exigeDigito && !/[0-9]/.test(val)) return false;
        // Un dígito seguido de letra delata un identificador técnico (`S4TextField`, `base64Encode`),
        // no una contraseña. Sólo se aplica al valor suelto: `'admin123'` entrecomillado sigue siendo literal.
        if (esSuelto && /[0-9][A-Za-z]/.test(val)) return false;
        if (ALLOW_MARKERS.test(val)) return false;
        if (TECHNICAL_VOCAB.test(val)) return false;
        if (NON_PASSWORD_VALUES.has(val.toLowerCase())) return false;
        return true;
      };

      // (b.1) literal entrecomillado inmediatamente después de `clave[:=]` (una sola palabra: un
      // mensaje de UI con espacios no es una contraseña)
      const reCitado = new RegExp(base + "(['\"`])([^'\"`\\s]{1,120})\\1", 'g');
      let m;
      while ((m = reCitado.exec(linea)) !== null) {
        if (sospechoso(m[2], false, false)) return true;
      }

      // (b.2) valor suelto (prosa/SQL/log) que parece contraseña: letra + dígito
      const reSuelto = new RegExp(base + "([^\\s'\"`(),;]+)", 'g');
      while ((m = reSuelto.exec(linea)) !== null) {
        if (sospechoso(m[1], true, true)) return true;
      }

      return false;
    }
  }
];

// Rutas exentas: archivos de documentación bajo docs/ (.md, .env.example, .example) y caché de .hermes/
const EXENTAS = [
  /^\.env\.example$/,
  /\.example$/,
  /^docs\/.*\.md$/i,
  /^\.hermes\//,
  /^\.secrets\//
];

// Dependencias y artefactos regenerables: no son código del proyecto.
const VENDOR = [/node_modules\//, /\/gradle\/wrapper\//, /\.min\.js$/, /^backend\/public\//, /\.map$/];

function gitGrep(pattern) {
  try {
    return execFileSync('git', ['grep', '-n', '-E', '-I', '-e', pattern, '--', '.'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err.status === 1) return '';
    throw err;
  }
}

/**
 * Ronda 5 (Cargo 1, vía B) — re-verificación propia del patrón.
 *
 * `git grep` selecciona las líneas de cada regla con SU `buscar`, pero `analizarSalida` etiquetaba con
 * la primera regla dispuesta a aceptarlas; la última («token o JWT en parámetro de URL») acepta
 * cualquier línea no comentada **sin volver a mirar su patrón**, así que se quedaba con las líneas que
 * las reglas anteriores seleccionaron por grep y rechazaron al validar (medido: 101 de 109).
 *
 * Aquí cada regla vuelve a comprobar SU PROPIO `buscar` antes de aceptar: **una línea no puede quedar
 * etiquetada con una regla que no la seleccionó** (y el recuento vuelve al real, sin recortar reglas).
 *
 * Ojo: `[[:space:]]` es POSIX y no existe en JS (en JS sería una clase con esos caracteres) ⇒ se
 * traduce a `\s` para medir exactamente lo mismo que `git grep -E` (que es case-sensitive, igual que JS).
 */
function patronDeBusqueda(patron) {
  return new RegExp(String(patron).replace(/\[\[:space:\]\]/g, '\\s'));
}

const REGLAS_CON_REVERIFICACION = REGLAS.map((regla) => ({
  ...regla,
  validar: (linea, archivo) => patronDeBusqueda(regla.buscar).test(linea) && regla.validar(linea, archivo),
}));

function analizarSalida(rawOutput, options = {}) {
  const normalize = options.normalize !== false;
  const processedOutput = normalize 
    ? (rawOutput || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : (rawOutput || '');

  const hallazgos = [];
  const lineas = processedOutput.split('\n');

  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const m = linea.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, archivo, numLinea, contenido] = m;
    if (EXENTAS.some((re) => re.test(archivo))) continue;
    if (VENDOR.some((re) => re.test(archivo))) continue;

    for (const regla of REGLAS_CON_REVERIFICACION) {
      if (regla.validar(contenido, archivo)) {
        hallazgos.push({ archivo, numLinea, nombre: regla.nombre });
        break;
      }
    }
  }

  return {
    hallazgos,
    exitCode: hallazgos.length > 0 ? 1 : 0
  };
}

function validarLinea(contenido, archivo, reglaNombre, normalize = true) {
  const regla = REGLAS.find(r => r.nombre === reglaNombre);
  if (!regla) return false;

  if (!normalize) {
    const rawLine = contenido; // conserva \r
    if (/^\s*(\/\/|\/\*|\*|#)/.test(rawLine.trim())) return { detected: false };
    const re = /(?:const|let|var|this\.)?\s*([A-Za-z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|KEY|CLAVE|PWD)[A-Za-z0-9_]*)\s*(?::|=|\|\||\?\?)\s*(?:['"]([^'"]+)['"]|([^\s#;,]+))/gi;
    let m;
    while ((m = re.exec(rawLine)) !== null) {
      const val = (m[2] !== undefined ? m[2] : m[3]) || '';
      if (!val || val.length < 4) continue;
      if (val.startsWith('$') || val.startsWith('${') || val.includes('${') || /^process\.env\./i.test(val) || /^env\./i.test(val)) continue;
      if (val.includes('(') || val.includes(')') || /^crypto\./i.test(val) || /^Buffer\./i.test(val)) continue;
      if (m[2] === undefined && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(val)) continue;
      if (/^(\*\*\*|REDACTED|TU_|YOUR_|changeme|PLACEHOLDER|xxx|example|dummy|REPLACE_ME)/i.test(val)) continue;
      if (ALLOW_MARKERS.test(val)) continue;
      return { detected: true, val };
    }
    return { detected: false };
  }

  const linea = contenido.replace(/\r$/, '');
  return regla.validar(linea, archivo);
}

function runScanner() {
  let rawOutput = '';
  for (const regla of REGLAS) {
    rawOutput += gitGrep(regla.buscar);
  }

  // Una línea que casa el `buscar` de varias reglas llega una vez por regla (git grep por regla).
  // Se deduplica por línea cruda (`archivo:linea:contenido`) para que el recuento del mensaje sea el
  // real y no cuente dos veces la misma credencial. La etiqueta la sigue decidiendo `analizarSalida`.
  const vistas = new Set();
  const lineasUnicas = [];
  for (const linea of (rawOutput || '').split('\n')) {
    if (!linea || vistas.has(linea)) continue;
    vistas.add(linea);
    lineasUnicas.push(linea);
  }

  const { hallazgos, exitCode } = analizarSalida(lineasUnicas.join('\n'));

  if (exitCode === 0) {
    console.log('✅ Sin credenciales versionadas en archivos trackeados.');
    process.exit(0);
  }

  console.error(`❌ ${hallazgos.length} credencial(es) en archivos TRACKEADOS (no se imprime ningún valor):`);
  for (const h of hallazgos) {
    console.error(`   ${h.archivo}:${h.numLinea} — ${h.nombre}`);
  }
  console.error('\nAcción: mover el valor a una variable de entorno, rotarlo y purgar del historial (A360-2026-09-22/C-02).');
  process.exit(exitCode);
}

if (require.main === module) {
  runScanner();
} else {
  module.exports = { REGLAS, EXENTAS, VENDOR, ALLOW_MARKERS, validarLinea, analizarSalida, runScanner };
}
