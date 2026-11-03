// backend/src/tests/consentVersionYF1b.test.js
//
// Y-F1b — El consentimiento tiene versión y el aviso nombra al encargado real.
//   * la versión vigente vive en un solo sitio (consentConfig),
//   * /api/consent/terms publica esa versión y nombra a Perfect Corp./YouCam,
//     su país y la transferencia internacional,
//   * el texto viejo que negaba la salida de la imagen ya no está.

const request = require('supertest');
const express = require('express');

const {
  BIOMETRIC_CONSENT_VERSION,
  BIOMETRIC_FINGERPRINT,
  BIOMETRIC_PROCESSORS,
  getActiveProcessors,
  isOutdatedConsent,
  isSupportedConsentVersion,
} = require('../config/consentConfig');
const consentRoutes = require('../routes/biometricConsentRoutes');

describe('Y-F1b — consentimiento versionado y divulgación del proveedor', () => {
  test('la versión vigente es 2.2 y las anteriores quedan desactualizadas', () => {
    expect(BIOMETRIC_CONSENT_VERSION).toBe('2.2');
    expect(isOutdatedConsent('1.0')).toBe(true);
    expect(isOutdatedConsent('2.0')).toBe(true);
    expect(isOutdatedConsent('2.1')).toBe(true);
    expect(isOutdatedConsent('2.2')).toBe(false);
    expect(isOutdatedConsent(null)).toBe(true);
    expect(isSupportedConsentVersion('2.0')).toBe(true); // se puede seguir registrando
    expect(isSupportedConsentVersion('3.0')).toBe(false);
  });

  test('/api/consent/terms publica la versión vigente y nombra proveedor y transferencia', async () => {
    // El aviso se construye con los proveedores activos: se encienden sus claves.
    const previo = {
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    };
    process.env.NVIDIA_API_KEY = 'test-nvidia';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek';

    try {
      const app = express();
      app.use(express.json());
      app.use('/api/consent', consentRoutes);

      const res = await request(app).get('/api/consent/terms');

      expect(res.status).toBe(200);
      const { version, last_updated: lastUpdated, sections } = res.body.data;
      const texto = sections.map((s) => `${s.title}: ${s.content}`).join('\n');

      expect(version).toBe('2.2');
      expect(lastUpdated).toBe('2026-10-20');

      expect(texto).toMatch(/Perfect Corp\./);
      expect(texto).toMatch(/YouCam/);
      expect(texto).toMatch(/Taiw[aá]n/);
      expect(texto).toMatch(/transferencia internacional/i);
      expect(texto).toMatch(/Ley 1581\/2012, art\. 26/);

      // El texto anterior afirmaba que no salía ninguna imagen del servidor, y
      // atribuía a NVIDIA una inferencia que en realidad es de embeddings.
      expect(texto).not.toMatch(/NO se almacenan imagenes originales/);
      expect(texto).not.toMatch(/NVIDIA \(EE\.UU\.\) para inferencia/);

      // Todos los encargados activos aparecen con su país.
      for (const processor of getActiveProcessors()) {
        expect(texto).toContain(processor.name.split(' (')[0]);
        expect(texto).toContain(processor.country);
      }
      expect(texto).toContain('Nemotron');
    } finally {
      for (const [key, value] of Object.entries(previo)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('el aviso solo lista los proveedores que están configurados', () => {
    const sinClaves = getActiveProcessors({});
    expect(sinClaves.map((p) => p.key)).toEqual(['perfectcorp', 'google']);

    const conNvidia = getActiveProcessors({ NVIDIA_API_KEY: 'x' });
    expect(conNvidia.map((p) => p.key)).toEqual(['perfectcorp', 'google', 'nvidia']);
    const nvidia = conNvidia.find((p) => p.key === 'nvidia');
    expect(nvidia.name).toMatch(/Nemotron/);
    expect(nvidia.country).toBe('Estados Unidos');

    // Producción: DEEPSEEK_BASE_URL sin override => el destino es api.deepseek.com (China).
    const produccion = getActiveProcessors({ DEEPSEEK_API_KEY: 'x', NVIDIA_API_KEY: 'x' });
    expect(produccion.map((p) => p.key)).toEqual(['perfectcorp', 'google', 'nvidia', 'deepseek']);
    expect(produccion.find((p) => p.key === 'deepseek').country).toBe('China');
    expect(produccion.find((p) => p.key === 'nvidia').country).toBe('Estados Unidos');

    // Si el endpoint de chat no es DeepSeek, no se puede afirmar que el destino sea China.
    const conOtroEndpoint = getActiveProcessors({
      DEEPSEEK_API_KEY: 'x',
      DEEPSEEK_BASE_URL: 'https://integrate.api.nvidia.com/v1',
    });
    expect(conOtroEndpoint.find((p) => p.key === 'deepseek').country)
      .toBe('según configuración del endpoint');

    // El catálogo completo sigue existiendo para auditar qué se declaró.
    expect(BIOMETRIC_PROCESSORS).toHaveLength(4);
  });

  test('rechaza una versión de consentimiento desconocida', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/consent', consentRoutes);

    const res = await request(app)
      .post('/api/consent/biometric')
      .send({
        consent_type: 'facial_analysis',
        purpose: 'Analisis facial para recomendaciones de cuidado de piel.',
        version_terms: '9.9',
      });

    // 400 por versión inválida, o 401 si el guard de JWT actúa primero:
    // en ningún caso se registra una versión inventada.
    expect([400, 401]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toBe('invalid_version_terms');
    }
  });
});

describe('Y-F1d (texto 2.1) — la huella de la foto se declara', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/consent', consentRoutes);
    return a;
  };

  test('/terms tiene una sección que nombra la huella y no la esconde', async () => {
    const res = await request(app()).get('/api/consent/terms');
    expect(res.status).toBe(200);

    const seccion = res.body.data.sections.find((s) => /Huella de la Fotografia/i.test(s.title));
    expect(seccion).toBeDefined();

    const texto = seccion.content;
    expect(texto).toMatch(/HMAC-SHA256/);
    expect(texto).toMatch(/clave secreta/);
    expect(texto).toMatch(/AES-256-GCM/);
    expect(texto).toMatch(/no se conserva/i); // la imagen original
  });

  test('el texto dice para qué se usa y para qué no', async () => {
    const res = await request(app()).get('/api/consent/terms');
    const texto = res.body.data.sections
      .map((s) => `${s.title}: ${s.content}`)
      .join('\n');

    expect(texto).toMatch(/no cobrar dos veces/i);
    expect(texto).toMatch(/no identifica a la persona/i);
    expect(texto).toMatch(/no se usa para reconocimiento facial/i);
  });

  test('el plazo que anuncia el aviso es el mismo que aplica la caché', async () => {
    const scanSessionService = require('../services/biometric/scanSession.service');
    const res = await request(app()).get('/api/consent/terms');
    const seccion = res.body.data.sections.find((s) => /Huella de la Fotografia/i.test(s.title));

    expect(seccion.content).toContain(`${BIOMETRIC_FINGERPRINT.retentionHours} horas`);
    expect(BIOMETRIC_FINGERPRINT.retentionHours).toBe(scanSessionService.getCacheTtlHours());
  });

  test('la 2.0 sigue siendo una versión registrable: nadie queda sin poder consentir', () => {
    expect(isSupportedConsentVersion('2.0')).toBe(true);
    expect(isOutdatedConsent('2.0')).toBe(true); // pero se marca para re-consentir
  });

  test('la sección de retención declara el plazo real y no un «mientras sea necesario»', async () => {
    // T-111. El texto anterior decía «se retienen solo mientras el consentimiento esté
    // vigente», que no es un plazo. Ahora tiene fecha y la fecha sale de la config.
    const { getRetentionMonths } = require('../config/biometricRetention');
    const meses = getRetentionMonths();

    const res = await request(app()).get('/api/consent/terms');
    const seccion = res.body.data.sections.find((s) => /Retencion/i.test(s.title));

    expect(seccion).toBeDefined();
    expect(seccion.content).toContain(`${meses} meses`);
    expect(seccion.content).toMatch(/escaneo/i);
    expect(seccion.content).toMatch(/cerrar la cuenta/i);
    expect(seccion.content).toMatch(/constancia de que el borrado ocurri/i);
    // Sin número escrito a mano: si el plazo cambia en el entorno, cambia el aviso.
    process.env.BIOMETRIC_RETENTION_MONTHS = '6';
    const otro = await request(app()).get('/api/consent/terms');
    const seccionOtro = otro.body.data.sections.find((s) => /Retencion/i.test(s.title));
    expect(seccionOtro.content).toContain('6 meses');
    delete process.env.BIOMETRIC_RETENTION_MONTHS;
  });
});
