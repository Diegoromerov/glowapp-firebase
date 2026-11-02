#!/usr/bin/env node
/**
 * backend/scripts/sandboxWompiE2E.js
 *
 * Prueba de humo REAL contra la API de Wompi en **Sandbox**: crea transacciones
 * de verdad (dinero falso) con los valores de prueba documentados y comprueba
 * que el estado final es el esperado.
 *
 * Es lo único que faltaba para dejar de validar la integración sólo contra el
 * contrato y los mocks: aquí hablan Wompi y nuestro código de verdad.
 *
 * SEGURIDAD — este script apunta SIEMPRE a sandbox. Nunca a producción, ni
 * siquiera con llaves de producción puestas, salvo que se pase --prod de forma
 * explícita. Un "smoke test" que cobra dinero real no es un smoke test.
 *
 * Uso:
 *   node backend/scripts/sandboxWompiE2E.js
 *
 * Requiere en el entorno (o en backend/.env):
 *   WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET
 *   (prefijos de sandbox: pub_test_, prv_test_, test_integrity_, test_events_)
 *
 * Salida: 0 si TODOS los casos dieron el resultado esperado; 1 si algo falló.
 */

const path = require('path');
const crypto = require('crypto');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const args = process.argv.slice(2);
const FORZAR_PROD = args.includes('--prod');
const BASE_URL_ARG = (args.find((a) => a.startsWith('--base-url=')) || '').split('=').slice(1).join('=');

const SANDBOX = 'https://sandbox.wompi.co/v1';

// El host se fija ANTES de usar el cliente (lee la URL base en cada llamada).
// Por defecto SIEMPRE sandbox. `--base-url` existe sólo para poder probar este
// propio script contra un servidor local que imite a Wompi.
if (BASE_URL_ARG) {
  process.env.WOMPI_BASE_URL = BASE_URL_ARG.replace(/\/$/, '');
} else if (!FORZAR_PROD) {
  process.env.WOMPI_BASE_URL = SANDBOX;
}

const wompiClient = require('../src/services/wompiClient');

// ── Valores de prueba documentados por Wompi ────────────────────────────────
const CARD_APROBADA = '4242424242424242';
const CARD_DECLINADA = '4111111111111111';
const NEQUI_APROBADA = '3991111111';
const NEQUI_DECLINADA = '3992222222';

const MONTO_CENTAVOS = 150000; // $1.500 COP
const EMAIL_PRUEBA = 'pruebas@glowapp.local';

const resultados = [];
let fallos = 0;

function registrar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${detalle ? `  — ${detalle}` : ''}`);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sondea hasta un estado final (Wompi nunca responde sincrónicamente). */
async function esperarEstadoFinal(id, { timeoutMs = 90000, cadaMs = 3000 } = {}) {
  const FINALES = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];
  const limite = Date.now() + timeoutMs;
  let ultimo = null;

  while (Date.now() < limite) {
    const tx = await wompiClient.getTransaction(id);
    ultimo = tx.status;
    if (FINALES.includes(tx.status)) return tx;
    await esperar(cadaMs);
  }
  throw new Error(`La transacción ${id} no llegó a estado final en ${timeoutMs / 1000}s (último: ${ultimo}).`);
}

/**
 * Crea una transacción y espera su estado final.
 *
 * Resuelve además una ambigüedad real: la doc oficial dice que POST /transactions
 * va con la llave PRIVADA, pero un SDK de terceros afirma que el camino con
 * `payment_method` usa la PÚBLICA. Se intenta la privada y, sólo si Wompi la
 * rechaza por autenticación, se reintenta con la pública — así queda resuelto
 * con evidencia en vez de por suposición.
 */
async function crearTransaccion(params) {
  try {
    return { tx: await wompiClient.createTransaction({ ...params, auth: 'private' }), authUsada: 'privada' };
  } catch (err) {
    const esAuth = err.status === 401 || err.status === 403;
    if (!esAuth) throw err;
    console.log(`    · la llave privada fue rechazada (${err.status}); reintentando con la pública…`);
    const tx = await wompiClient.createTransaction({ ...params, auth: 'public' });
    return { tx, authUsada: 'pública' };
  }
}

async function casoConTarjeta({ etiqueta, numero, esperado }) {
  console.log(`\n▸ ${etiqueta} (tarjeta ${numero.slice(0, 4)}…)`);

  const tokenizado = await wompiClient.tokenizeCard({
    number: numero,
    cvc: '123',
    expMonth: '12',
    expYear: '29',
    cardHolder: 'PRUEBA HERMES'
  });
  registrar(`${etiqueta}: tokeniza la tarjeta`, Boolean(tokenizado.id), `token ${String(tokenizado.id).slice(0, 18)}…`);

  const { acceptanceToken } = await wompiClient.getAcceptanceTokens();
  const reference = `hermes-e2e-card-${Date.now()}-${esperado}`;

  const { tx, authUsada } = await crearTransaccion({
    amountInCents: MONTO_CENTAVOS,
    currency: 'COP',
    reference,
    customerEmail: EMAIL_PRUEBA,
    acceptanceToken,
    paymentMethod: { type: 'CARD', token: tokenizado.id, installments: 1 }
  });
  registrar(`${etiqueta}: crea la transacción`, Boolean(tx.id), `id ${tx.id} (auth ${authUsada})`);

  const final = await esperarEstadoFinal(tx.id);
  registrar(`${etiqueta}: estado final = ${esperado}`, final.status === esperado, `obtenido ${final.status}`);
}

async function casoConNequi({ etiqueta, telefono, esperado }) {
  console.log(`\n▸ ${etiqueta} (Nequi ${telefono})`);

  const { acceptanceToken } = await wompiClient.getAcceptanceTokens();
  const reference = `hermes-e2e-nequi-${Date.now()}-${esperado}`;

  const { tx, authUsada } = await crearTransaccion({
    amountInCents: MONTO_CENTAVOS,
    currency: 'COP',
    reference,
    customerEmail: EMAIL_PRUEBA,
    acceptanceToken,
    paymentMethod: { type: 'NEQUI', phone_number: telefono }
  });
  registrar(`${etiqueta}: crea la transacción`, Boolean(tx.id), `id ${tx.id} (auth ${authUsada})`);

  const final = await esperarEstadoFinal(tx.id);
  registrar(`${etiqueta}: estado final = ${esperado}`, final.status === esperado, `obtenido ${final.status}`);
}

(async () => {
  console.log('══ Smoke E2E de Wompi en SANDBOX ══');
  console.log(`Host: ${wompiClient.baseUrl}`);

  if (!wompiClient.isConfigured()) {
    console.log('\n✗ Faltan credenciales: se necesitan WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY,');
    console.log('  WOMPI_INTEGRITY_SECRET y WOMPI_EVENTS_SECRET (prefijos de sandbox).');
    console.log('  Revísalas con:  npm run verify:wompi');
    process.exit(1);
  }

  const host = wompiClient.baseUrl;
  const esSandbox = /sandbox/.test(host);
  const esStubLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(host);

  if (!esSandbox && !esStubLocal) {
    console.log('\n✗ ABORTADO: el host no es sandbox y este script crea transacciones.');
    console.log('  Quita --prod para apuntar a sandbox. Nunca corras esto contra producción.');
    process.exit(1);
  }
  if (esStubLocal) {
    console.log('  ⚠️  host LOCAL (stub de pruebas): NO es Wompi. Sólo valida el script.');
  }

  const usaTest = /_test_/.test(String(process.env.WOMPI_PUBLIC_KEY || ''));
  if (esSandbox) {
    console.log(usaTest ? '  ✓ llaves con prefijo _test_' : '  ⚠️  las llaves NO tienen prefijo _test_ (¿son de sandbox?)');
  }

  console.log('\n── Firma de integridad (cálculo local) ──');
  try {
    const firma = wompiClient.createIntegritySignature({ reference: 'X', amountInCents: 1000, currency: 'COP' });
    registrar('produce un SHA256 hex de 64', /^[0-9a-f]{64}$/.test(firma));
  } catch (e) {
    registrar('produce un SHA256 hex de 64', false, e.message);
  }

  console.log('\n── Verificación de eventos (checksum real) ──');
  try {
    const evento = {
      event: 'transaction.updated',
      data: { transaction: { id: 'a', status: 'APPROVED', amount_in_cents: MONTO_CENTAVOS } },
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
      timestamp: Date.now()
    };
    const valores = evento.signature.properties
      .map((r) => r.split('.').reduce((a, k) => a[k], evento.data))
      .join('');
    evento.signature.checksum = crypto
      .createHash('sha256')
      .update(`${valores}${evento.timestamp}${process.env.WOMPI_EVENTS_SECRET}`)
      .digest('hex');

    const acepta = wompiClient.verifyEventChecksum(evento).valid === true;
    const rechaza = wompiClient.verifyEventChecksum({ ...evento, timestamp: evento.timestamp + 1 }).valid === false;
    registrar('acepta el evento correcto y rechaza el alterado', acepta && rechaza);
  } catch (e) {
    registrar('acepta el evento correcto y rechaza el alterado', false, e.message);
  }

  console.log('\n── Transacciones reales en sandbox ──');
  try {
    await casoConTarjeta({ etiqueta: 'Tarjeta aprobada', numero: CARD_APROBADA, esperado: 'APPROVED' });
    await casoConTarjeta({ etiqueta: 'Tarjeta declinada', numero: CARD_DECLINADA, esperado: 'DECLINED' });
    await casoConNequi({ etiqueta: 'Nequi aprobado', telefono: NEQUI_APROBADA, esperado: 'APPROVED' });
    await casoConNequi({ etiqueta: 'Nequi declinado', telefono: NEQUI_DECLINADA, esperado: 'DECLINED' });
  } catch (e) {
    registrar('transacciones en sandbox', false, e.message);
  }

  console.log('\n══ Resumen ══');
  for (const r of resultados) console.log(`  ${r.ok ? '✓' : '✗'} ${r.nombre}`);
  console.log(fallos === 0 ? '\n══ TODO EN VERDE ══' : `\n══ ${fallos} caso(s) fallido(s) ══`);
  process.exit(fallos === 0 ? 0 : 1);
})();
