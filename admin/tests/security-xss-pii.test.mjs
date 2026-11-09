#!/usr/bin/env node
/**
 * FIX-FLUTTER-04 — Guard estático + unitario (test-first).
 *
 * Cubre los hallazgos de la tarjeta:
 *   1) XSS: render directo, sin sanitizar, de campos controlados por el backend
 *      en el Centro de Auditoría admin  (business/page.tsx: {item.file_path},
 *      {item.reviewer_notes}).
 *   2) PII: el dashboard de cliente expone provider_name / service_address /
 *      valor_bruto en crudo  (cliente/page.tsx).
 *   3) CSP / cabeceras de seguridad declaradas en next.config.ts + middleware.
 *   4) Las funciones de sanitización neutralizan inyección real (unidad).
 *
 * Sin dependencias: se ejecuta con `node tests/security-xss-pii.test.mjs`.
 * Sale con código != 0 si algún caso falla (apto para CI).
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(HERE, '..');
const p = (...x) => path.join(DASH, ...x);

const BUSINESS_PAGE = p('src', 'app', '(dashboard)', 'admin', 'business', 'page.tsx');
const CLIENTE_PAGE = p('src', 'app', '(dashboard)', 'cliente', 'page.tsx');
const SECURITY_MODULE = p('src', 'lib', 'security.ts');
const NEXT_CONFIG = p('next.config.ts');
const MIDDLEWARE = [p('src', 'middleware.ts'), p('middleware.ts')].find((f) => existsSync(f));

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

/** Devuelve el fuente tras eliminar todas las apariciones de `expr`. */
function without(src, expr) {
  return src.split(expr).join('');
}

/**
 * Un campo controlado por el backend solo puede aparecer dentro de su wrapper
 * de saneamiento. Si tras eliminar las llamadas `wrapper(...)` el campo sigue
 * apareciendo en el fuente => hay (al menos) un render/usos sin sanitizar.
 */
function assertOnlyWrapped(file, expr, wrapperCall, label) {
  const raw = read(file);
  assert.ok(
    raw.includes(wrapperCall),
    `${label}: falta la llamada de saneamiento esperada \`${wrapperCall}\``
  );
  const rest = without(raw, wrapperCall);
  assert.ok(
    !rest.includes(expr),
    `${label}: uso sin sanitizar de \`${expr}\` (fuera de \`${wrapperCall}\`)`
  );
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------------ *
 * 1) XSS — Centro de Auditoría admin (business/page.tsx)
 * ------------------------------------------------------------------ */
test('business/page.tsx: item.file_path solo se renderiza vía sanitizePath()', () => {
  assertOnlyWrapped(BUSINESS_PAGE, 'item.file_path', 'sanitizePath(item.file_path)', 'file_path');
});

test('business/page.tsx: item.reviewer_notes solo se renderiza vía sanitizeText()', () => {
  assertOnlyWrapped(
    BUSINESS_PAGE,
    'item.reviewer_notes',
    'sanitizeText(item.reviewer_notes)',
    'reviewer_notes'
  );
});

test('admin-dashboard/src: no existe dangerouslySetInnerHTML', () => {
  const root = p('src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry) && readFileSync(full, 'utf8').includes('dangerouslySetInnerHTML')) {
        hits.push(path.relative(DASH, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, [], `dangerouslySetInnerHTML detectado en: ${hits.join(', ')}`);
});

/* ------------------------------------------------------------------ *
 * 2) PII — Dashboard de cliente (cliente/page.tsx)
 * ------------------------------------------------------------------ */
test('cliente/page.tsx: provider_name no se expone en crudo (se enmascara)', () => {
  assertOnlyWrapped(
    CLIENTE_PAGE,
    'booking.provider_name',
    'maskProviderName(booking.provider_name)',
    'provider_name'
  );
});

test('cliente/page.tsx: service_address no se expone en crudo (se enmascara)', () => {
  assertOnlyWrapped(
    CLIENTE_PAGE,
    'booking.service_address',
    'maskServiceAddress(booking.service_address)',
    'service_address'
  );
});

test('cliente/page.tsx: valor_bruto no se expone en crudo (importe visible cliente)', () => {
  assertOnlyWrapped(
    CLIENTE_PAGE,
    'booking.valor_bruto',
    'toClientVisibleAmount(booking.valor_bruto)',
    'valor_bruto'
  );
});

test('cliente/page.tsx: el agregado curr.valor_bruto también se normaliza', () => {
  assertOnlyWrapped(
    CLIENTE_PAGE,
    'curr.valor_bruto',
    'toClientVisibleAmount(curr.valor_bruto)',
    'agregado valor_bruto'
  );
});

/* ------------------------------------------------------------------ *
 * 3) CSP / cabeceras de seguridad
 * ------------------------------------------------------------------ */
test('next.config.ts declara Content-Security-Policy vía headers()', () => {
  const cfg = read(NEXT_CONFIG);
  assert.ok(/headers\s*\(/.test(cfg), 'next.config.ts no define headers()');
  assert.ok(
    cfg.includes('Content-Security-Policy') || cfg.includes('SECURITY_HEADERS'),
    'next.config.ts no aplica Content-Security-Policy'
  );
});

test('middleware.ts aplica Content-Security-Policy', () => {
  assert.ok(MIDDLEWARE, 'no existe middleware.ts (raíz o src/)');
  assert.ok(
    read(MIDDLEWARE).includes('Content-Security-Policy') ||
      read(MIDDLEWARE).includes('SECURITY_HEADERS'),
    'middleware.ts no aplica Content-Security-Policy'
  );
});

/* ------------------------------------------------------------------ *
 * 4) Unidad — las funciones neutralizan inyección real
 * ------------------------------------------------------------------ */
test('src/lib/security.ts existe y exporta los helpers requeridos', async () => {
  assert.ok(existsSync(SECURITY_MODULE), 'falta src/lib/security.ts');
  const mod = await import(pathToFileURL(SECURITY_MODULE).href);
  for (const fn of [
    'escapeHtml',
    'sanitizeText',
    'sanitizePath',
    'maskProviderName',
    'maskServiceAddress',
    'toClientVisibleAmount',
  ]) {
    assert.equal(typeof mod[fn], 'function', `falta la exportación ${fn}()`);
  }
});

test('sanitizeText neutraliza <script>, onerror y esquemas activos', async () => {
  const { sanitizeText } = await import(pathToFileURL(SECURITY_MODULE).href);
  const vectors = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "<svg/onload=alert('xss')>",
    'javascript:alert(document.cookie)',
    'Nota<\/script><script>fetch("/steal")<\/script>',
  ];
  for (const v of vectors) {
    const out = sanitizeText(v);
    assert.ok(!/[<>]/.test(out), `sanitizeText dejó etiquetas activas: ${JSON.stringify(out)}`);
    assert.ok(!/javascript\s*:/i.test(out), `sanitizeText dejó esquema javascript: ${JSON.stringify(out)}`);
  }
});

test('sanitizePath neutraliza javascript:, data: y path traversal', async () => {
  const { sanitizePath } = await import(pathToFileURL(SECURITY_MODULE).href);
  const js = sanitizePath('javascript:alert(1)');
  assert.ok(!/javascript\s*:/i.test(js), `esquema activo sobrevive: ${JSON.stringify(js)}`);
  const data = sanitizePath('data:text/html,<script>alert(1)</script>');
  assert.ok(!/data\s*:/i.test(data), `esquema data: sobrevive: ${JSON.stringify(data)}`);
  assert.ok(!/[<>]/.test(data), `etiquetas sobreviven: ${JSON.stringify(data)}`);
  const trav = sanitizePath('../../../etc/passwd');
  assert.ok(!/\.\.[/\\]/.test(trav), `traversal sobrevive: ${JSON.stringify(trav)}`);
});

test('escapeHtml escapa los metacaracteres HTML', async () => {
  const { escapeHtml } = await import(pathToFileURL(SECURITY_MODULE).href);
  const out = escapeHtml(`<a href="x" onmouseover='y'>&</a>`);
  assert.ok(!/[<>"']/.test(out), `escapeHtml dejó metacaracteres: ${JSON.stringify(out)}`);
  assert.ok(out.includes('&lt;') && out.includes('&amp;'), `escapeHtml no escapó: ${JSON.stringify(out)}`);
});

test('maskProviderName no revela el nombre completo', async () => {
  const { maskProviderName } = await import(pathToFileURL(SECURITY_MODULE).href);
  const out = maskProviderName('Carlos Gómez');
  assert.notEqual(out, 'Carlos Gómez');
  assert.ok(!/Carlos|Gómez/.test(out), `nombre sin enmascarar: ${JSON.stringify(out)}`);
  assert.equal(maskProviderName(''), 'Profesional asignado');
  assert.equal(maskProviderName(null), 'Profesional asignado');
});

test('maskServiceAddress redacta la dirección exacta', async () => {
  const { maskServiceAddress } = await import(pathToFileURL(SECURITY_MODULE).href);
  const out = maskServiceAddress('Cra 10 #45-12, Bogotá');
  assert.ok(!out.includes('45-12'), `dirección exacta visible: ${JSON.stringify(out)}`);
  assert.ok(!/\d/.test(out.replace(/\([^)]*\)/g, '')), `dígitos de la dirección visibles: ${JSON.stringify(out)}`);
  assert.ok(out.includes('Bogotá'), `se perdió la referencia de ciudad: ${JSON.stringify(out)}`);
  assert.equal(maskServiceAddress(''), '');
});

test('toClientVisibleAmount devuelve un COP entero y seguro', async () => {
  const { toClientVisibleAmount } = await import(pathToFileURL(SECURITY_MODULE).href);
  assert.equal(toClientVisibleAmount(150000), 150000);
  assert.equal(toClientVisibleAmount('150000.99'), 150001);
  assert.equal(toClientVisibleAmount(null), 0);
  assert.equal(toClientVisibleAmount(undefined), 0);
  assert.equal(toClientVisibleAmount('no-numero'), 0);
  assert.equal(toClientVisibleAmount(-5), 0);
});

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */
let failed = 0;
const pad = (s, n) => String(s).padEnd(n);
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`\u2713 PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`\u2717 FAIL  ${name}`);
    console.log(`        ${String(err.message).split('\n')[0]}`);
  }
}
const total = tests.length;
console.log('\n' + '-'.repeat(72));
console.log(`${pad('RESULTADO', 12)} ${total - failed}/${total} PASS  |  ${failed} FAIL`);
if (failed > 0) {
  console.log('ESTADO: ROJO — FIX-FLUTTER-04 no remediado');
  process.exitCode = 1;
} else {
  console.log('ESTADO: VERDE — FIX-FLUTTER-04 remediado');
}
