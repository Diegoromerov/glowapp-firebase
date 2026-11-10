// Ítem 44 — los logs no deben llevar PII en claro.
//
// El backend ya tenía `piiSanitizer`, pero solo lo usaban el servicio de Gemini
// y el logger de RAG: las rutas de auth y los trabajos programados imprimían
// correos completos. Este test fija las dos cosas: que el enmascarado funcione
// y que no vuelva a colarse un log con el correo crudo.
const fs = require('fs');
const path = require('path');
const { maskEmail, sanitizeForLog } = require('../utils/piiSanitizer');

describe('maskEmail', () => {
  test('conserva el dominio y oculta el buzón', () => {
    expect(maskEmail('diana@glowapp.co')).toBe('d***@glowapp.co');
  });

  test('no revienta con entradas raras', () => {
    expect(maskEmail(null)).toBe('[SIN_EMAIL]');
    expect(maskEmail('')).toBe('[SIN_EMAIL]');
    expect(maskEmail('sin-arroba')).toBe('[EMAIL_INVALIDO]');
  });
});

describe('sanitizeForLog', () => {
  test('redacta correos y teléfonos dentro de texto libre', () => {
    const salida = sanitizeForLog('cliente ana@x.co tel 3001234567');
    expect(salida).not.toContain('ana@x.co');
    expect(salida).not.toContain('3001234567');
  });
});

describe('invariante de fuente: ningún log imprime correos crudos', () => {
  const archivos = [
    'src/controllers/authController.js',
    'src/controllers/bookingController.js',
    'src/jobs/retentionNotification.js',
    'src/jobs/trialDunningCron.js',
  ];
  const raiz = path.resolve(__dirname, '..', '..');

  test.each(archivos)('%s', (rel) => {
    const lineas = fs.readFileSync(path.join(raiz, rel), 'utf8').split('\n');
    const infractoras = [];
    lineas.forEach((linea, i) => {
      if (!/console\.(log|warn|error|info)\s*\(/.test(linea)) return;
      if (!/email/i.test(linea)) return;
      if (/maskEmail|sanitizeForLog|REDACTED|SIN_EMAIL/.test(linea)) return;
      // Solo importa si el valor del correo se interpola o se pasa como
      // argumento. `emailErr.message` es un mensaje de error, no un correo.
      if (/email(err|error)/i.test(linea)) return;
      const interpola =
        /\$\{[^}]*email\w*[^}]*\}/i.test(linea) ||
        /,\s*[\w.]*\.(email|email_cliente|owner_email)/i.test(linea) ||
        /,\s*(email|cleanEmail)\s*[,)]/.test(linea) ||
        /(email_cliente|owner_email|cleanEmail)/.test(linea);
      if (interpola) infractoras.push(`${i + 1}: ${linea.trim()}`);
    });
    expect(infractoras).toEqual([]);
  });
});
