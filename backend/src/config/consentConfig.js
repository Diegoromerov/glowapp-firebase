// backend/src/config/consentConfig.js
//
// Y-F1b — Fuente única de verdad del consentimiento biométrico.
//
// Por qué existe: la versión del consentimiento estaba escrita a mano en tres sitios
// (`'1.0'` en el frontend, `versionTerms = '1.0'` por defecto en consentService y nada
// en la ruta POST, que ignoraba el campo). Así el usuario aceptaba un texto y la base
// registraba otro número sin relación con lo que leyó.
//
// Aquí vive la versión vigente, las versiones aceptables y los encargados del
// tratamiento que el texto debe nombrar (Ley 1581 de 2012, transferencia internacional).

const { describeRetention } = require('./biometricRetention');

/** Versión del texto de consentimiento que se muestra hoy al usuario. */
const BIOMETRIC_CONSENT_VERSION = '2.2';

/**
 * Versiones que el backend acepta registrar. Una versión desconocida se rechaza con
 * 400: guardar un número inventado deja el registro auditable sin valor probatorio.
 */
const SUPPORTED_CONSENT_VERSIONS = Object.freeze(['1.0', '2.0', '2.1', '2.2']);

/**
 * Y-F1d (texto 2.1) — huella de la fotografía.
 *
 * Hasta la 2.0 el aviso hablaba de la imagen y de las métricas, pero no de que se
 * guarda un identificador de la foto para no volver a pagar la misma medición. Omitir
 * eso deja al titular sin saber qué queda de su imagen después del análisis, así que
 * la 2.1 lo declara con nombre y plazo.
 *
 * `retentionHours` se lee del mismo entorno que usa el servicio de caché
 * (`BIOMETRIC_CACHE_TTL_HOURS`): si mañana se cambia el plazo, el texto cambia solo.
 */
const BIOMETRIC_FINGERPRINT = Object.freeze({
  what: 'una huella criptográfica de la fotografía (HMAC-SHA256 con una clave secreta del servidor) '
    + 'y un descriptor perceptual de 64 bits cifrado con AES-256-GCM',
  purpose: 'reconocer si se vuelve a enviar la misma foto y reutilizar la medición ya realizada, '
    + 'para no cobrarla dos veces ni duplicar el escaneo',
  notStored: 'la imagen original no se conserva',
  notUsedFor: 'no identifica a la persona, no se usa para reconocimiento facial ni se comparte '
    + 'con ningún encargado',
  retentionHours: (() => {
    const n = Number.parseInt(process.env.BIOMETRIC_CACHE_TTL_HOURS, 10);
    return Number.isFinite(n) && n >= 0 ? n : 24;
  })(),
});

/**
 * Encargados del tratamiento a los que sale la fotografía o sus derivados.
 * `internationalTransfer` obliga a revelarlo en el texto (Ley 1581, art. 26).
 *
 * `activation` es la variable de entorno que hace real al proveedor: el aviso se
 * construye con los que están activos, no con una lista fija que se queda vieja
 * (el texto anterior nombraba NVIDIA y el código igual la usa, pero para embeddings).
 */
const BIOMETRIC_PROCESSORS = Object.freeze([
  Object.freeze({
    key: 'perfectcorp',
    name: 'Perfect Corp. (YouCam AI Skin Analysis)',
    country: 'Taiwán',
    purpose: 'medición de métricas cutáneas sobre la fotografía facial',
    dataShared: 'fotografía facial y resultado del análisis por subregión',
    internationalTransfer: true,
    activation: null, // es el motor de este consentimiento: siempre activo
  }),
  Object.freeze({
    key: 'google',
    name: 'Google (Gemini API)',
    country: 'Estados Unidos',
    purpose: 'análisis de la fotografía de manos',
    dataShared: 'fotografía de manos',
    internationalTransfer: true,
    activation: null, // el análisis de manos forma parte del mismo escaneo
  }),
  Object.freeze({
    key: 'nvidia',
    name: 'NVIDIA (Nemotron vía NIM)',
    country: 'Estados Unidos',
    purpose: 'representación vectorial de la consulta y del catálogo para la búsqueda semántica',
    dataShared: 'texto de la consulta y del catálogo (sin la imagen)',
    internationalTransfer: true,
    activation: 'NVIDIA_API_KEY',
  }),
  Object.freeze({
    key: 'deepseek',
    name: 'DeepSeek',
    country: 'China',
    purpose: 'redacción de la recomendación a partir de las métricas (sin la imagen)',
    dataShared: 'métricas numéricas del análisis',
    internationalTransfer: true,
    activation: 'DEEPSEEK_API_KEY',
  }),
]);

/**
 * Proveedores que el proceso puede usar de verdad. Se evalúa en cada petición: si
 * mañana cambia la clave o el endpoint, el aviso cambia con ella.
 */
function getActiveProcessors(env = process.env) {
  return BIOMETRIC_PROCESSORS.filter((processor) => {
    if (!processor.activation) return true;
    if (processor.key === 'deepseek') {
      return Boolean(env.DEEPSEEK_API_KEY || env.OPENROUTER_API_KEY);
    }
    return Boolean(env[processor.activation]);
  }).map((processor) => {
    // El endpoint de chat es configurable: si no apunta a DeepSeek, el país del
    // proveedor deja de ser China y no se puede afirmar cuál es.
    if (processor.key === 'deepseek' && env.DEEPSEEK_BASE_URL
        && !env.DEEPSEEK_BASE_URL.includes('deepseek.com')) {
      return { ...processor, country: 'según configuración del endpoint' };
    }
    return processor;
  });
}

/** Cambios que justifican subir la versión. Se anota, no se interpreta. */
const CONSENT_VERSION_NOTES = Object.freeze({
  '1.0': 'Texto inicial: finalidad, registro auditable y derechos ARCO.',
  '2.0': 'Nombra a Perfect Corp./YouCam (Taiwán), NVIDIA (Nemotron vía NIM) y DeepSeek '
    + 'con su país y la transferencia internacional; corrige la afirmación de que la '
    + 'imagen nunca sale de memoria de sesión.',
  '2.1': 'Declara la huella de la fotografía (HMAC con clave secreta + descriptor '
    + 'perceptual cifrado), para qué se guarda, cuánto tiempo y que no identifica a la '
    + 'persona ni se comparte. Sin este párrafo, el titular no sabía qué quedaba de su '
    + 'imagen después del análisis.',
  '2.2': 'Declara el plazo de conservación: 24 meses desde el último escaneo, purga '
    + 'también de las cuentas inactivas, borrado inmediato al cerrar la cuenta y '
    + 'constancia del borrado sin datos dentro. Sin plazo, «conservamos tus datos» no '
    + 'tenía fecha y la Ley 1581 exige temporalidad.',
});

/**
 * T-111 — plazo de conservación, tal como lo verá el titular en el aviso.
 * Se construye en cada llamada para que un cambio de entorno mueva el texto.
 */
function getRetentionNotice() {
  return describeRetention();
}

const isSupportedConsentVersion = (version) => SUPPORTED_CONSENT_VERSIONS.includes(version);

/**
 * Un consentimiento es vigente solo si su versión es exactamente la actual. Una versión
 * anterior no invalida el permiso (el usuario sí autorizó), pero el análisis queda
 * marcado para re-consentir: el texto que leyó no es el que rige.
 */
const isOutdatedConsent = (version) => version !== BIOMETRIC_CONSENT_VERSION;

module.exports = {
  BIOMETRIC_CONSENT_VERSION,
  SUPPORTED_CONSENT_VERSIONS,
  BIOMETRIC_PROCESSORS,
  BIOMETRIC_FINGERPRINT,
  CONSENT_VERSION_NOTES,
  getRetentionNotice,
  getActiveProcessors,
  isSupportedConsentVersion,
  isOutdatedConsent,
};
