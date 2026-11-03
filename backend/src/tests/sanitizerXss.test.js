/**
 * backend/src/tests/sanitizerXss.test.js
 * Test-first (rojo→verde) del hallazgo P0 SECAPP #2:
 *   "Sanitizer XSS regex casero bypassable" — backend/src/middleware/sanitizer.js:7
 *
 * El sanitizer anterior eliminaba patrones con regex casero, lo que es evadible:
 *   - `<scr<script>ipt>` se reensamblaba a un `<script>` vivo tras el replace.
 *   - `java\t<tab>script:` y `java&#115;cript:` no coinciden con /javascript:/.
 *   - `on<NUL>error=` no coincide con /on\w+\s*=/.
 *   - `<svg/onload=...>` sobrevive (queda el tag).
 *
 * Invariante de seguridad que debe cumplir toda salida: NO puede quedar ningún
 * tag/atributo HTML activo (ni `<` crudo que pueda reconstituir uno), con
 * independencia de la ofuscación. Además, el texto benigno no debe alterarse.
 *
 * Tests estáticos: no tocan BD ni red; solo el middleware puro.
 */

const sanitizer = require('../middleware/sanitizer');

// Aplica el middleware completo (igual que `app.use(sanitizer)`) sobre un body.
function sanitizeBody(body) {
  const req = { body, query: {}, params: {} };
  sanitizer(req, {}, () => {});
  return req.body;
}

describe('sanitizer (XSS) — anti-bypass (SECAPP #2)', () => {
  test('reensamblado de tag anidado <scr<script>ipt> no deja un <script> vivo', () => {
    const out = sanitizeBody('<scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<');
  });

  test('esquema ofuscado con tabulador (java\\tscript:) se neutraliza', () => {
    const out = sanitizeBody('<a href="java\tscript:alert(1)">x</a>');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('<');
  });

  test('handler ofuscado con NUL (on\\0error=) se neutraliza', () => {
    const out = sanitizeBody('<img src=x on\u0000error=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('\u0000');
  });

  test('SVG con handler (<svg/onload=...>) se neutraliza', () => {
    const out = sanitizeBody('<svg/onload=alert(1)>');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('<');
  });

  test('no sobre-sanitiza texto benigno (acentos, ñ, dígitos)', () => {
    const benign = 'Salón de belleza Ñandú 123';
    expect(sanitizeBody(benign)).toBe(benign);
  });

  test('recorre recursivamente objetos y arrays', () => {
    const out = sanitizeBody({
      nombre: '<script>alert(1)</script>',
      tags: ['<img src=x onerror=alert(1)>', 'ok'],
    });
    expect(out.nombre).not.toContain('<');
    expect(out.tags[0]).not.toContain('<');
    expect(out.tags[1]).toBe('ok');
  });
});
