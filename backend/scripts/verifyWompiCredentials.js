#!/usr/bin/env node
/**
 * backend/scripts/verifyWompiCredentials.js
 *
 * Verifica que las credenciales de Wompi estén bien puestas y FUNCIONEN, sin
 * imprimir ningún valor secreto: solo presencia, forma y el resultado de las
 * llamadas reales.
 *
 * Existe porque las credenciales nunca deben pasar por el chat ni por el
 * historial de una conversación. Se ponen en `backend/.env` (ignorado por git)
 * o en las variables de Railway, y se comprueban aquí.
 *
 * Uso:
 *   node backend/scripts/verifyWompiCredentials.js              # solo revisa presencia
 *   node backend/scripts/verifyWompiCredentials.js --live        # + llamadas de LECTURA a Wompi
 *   node backend/scripts/verifyWompiCredentials.js --live --payouts
 *   node backend/scripts/verifyWompiCredentials.js --live --prod  # permite tocar producción
 *
 * NUNCA crea transacciones ni dispersa dinero: solo GETs (merchant, bancos, cuentas).
 * Salida: 0 = todo lo exigido está presente y respondió; 1 = falta algo o falló.
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  /* dotenv es opcional: si no está, se usan las variables ya exportadas */
}

const wompiClient = require('../src/services/wompiClient');
const wompiPayoutsClient = require('../src/services/wompiPayoutsClient');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const CON_PAYOUTS = args.includes('--payouts');
const FORZAR_PROD = args.includes('--prod');
const FORZAR_SANDBOX = args.includes('--sandbox');

// Los flags deben cambiar el host REAL, no solo el que se imprime: los clientes
// leen la URL base del entorno en cada llamada, así que se fija aquí. Si no, el
// verificador apuntaría a sandbox con llaves de producción (422 "Formato
// inválido") y estaría reportando un host que no es el que usa.
if (FORZAR_PROD) {
  process.env.WOMPI_BASE_URL = 'https://production.wompi.co/v1';
  process.env.WOMPI_PAYOUTS_BASE_URL = 'https://api.payouts.wompi.co/v1';
} else if (FORZAR_SANDBOX) {
  process.env.WOMPI_BASE_URL = 'https://sandbox.wompi.co/v1';
  process.env.WOMPI_PAYOUTS_BASE_URL = 'https://api.sandbox.payouts.wompi.co/v1';
}

// ── Presentación sin filtrar secretos ────────────────────────────────────────

/**
 * Describe una variable sin revelar su valor. De una llave se muestra el prefijo
 * de entorno (`pub_prod`, `prv_test`, ...), que NO es el secreto y sirve para
 * saber si apunta a producción. De un secreto opaco, solo su longitud.
 */
function describir(nombre, valor, { llave = false } = {}) {
  if (!valor) return { ok: false, linea: `  ✗ ${nombre.padEnd(34)} AUSENTE` };

  let forma;
  if (llave) {
    const partes = String(valor).split('_');
    forma = partes.length >= 3 ? `${partes[0]}_${partes[1]}…` : `${valor.length} caracteres`;
  } else {
    forma = `${String(valor).length} caracteres`;
  }
  return { ok: true, linea: `  ✓ ${nombre.padEnd(34)} presente (${forma})` };
}

// ── Grupos de credenciales ──────────────────────────────────────────────────

const GRUPO_COBROS = [
  { nombre: 'WOMPI_PUBLIC_KEY', valor: process.env.WOMPI_PUBLIC_KEY, llave: true, exigido: true },
  { nombre: 'WOMPI_PRIVATE_KEY', valor: process.env.WOMPI_PRIVATE_KEY, llave: true, exigido: true },
  { nombre: 'WOMPI_INTEGRITY_SECRET', valor: process.env.WOMPI_INTEGRITY_SECRET, exigido: true },
  { nombre: 'WOMPI_EVENTS_SECRET', valor: process.env.WOMPI_EVENTS_SECRET, exigido: true }
];

const GRUPO_PAYOUTS = [
  { nombre: 'WOMPI_PAYOUTS_API_KEY', valor: process.env.WOMPI_PAYOUTS_API_KEY, exigido: true },
  { nombre: 'WOMPI_PAYOUTS_USER_PRINCIPAL_ID', valor: process.env.WOMPI_PAYOUTS_USER_PRINCIPAL_ID, exigido: true },
  { nombre: 'WOMPI_PAYOUTS_ACCOUNT_ID', valor: process.env.WOMPI_PAYOUTS_ACCOUNT_ID, exigido: true }
];

let fallos = 0;

function revisarGrupo(titulo, grupo, { exigido = true } = {}) {
  console.log(`\n${titulo}`);
  for (const v of grupo) {
    const { ok, linea } = describir(v.nombre, v.valor, { llave: v.llave });
    console.log(linea);
    if (!ok && v.exigido && exigido) fallos++;
  }
}

// ── Entorno y aviso de producción ───────────────────────────────────────────

const publicKey = String(process.env.WOMPI_PUBLIC_KEY || '');
const esProduccion = /_prod_/.test(publicKey) || /^prv_prod/.test(String(process.env.WOMPI_PRIVATE_KEY || ''));

console.log('══ Verificación de credenciales de Wompi ══');

revisarGrupo('Cobros (API de comercio):', GRUPO_COBROS);
revisarGrupo('Dispersiones / Pagos a Terceros (API separada):', GRUPO_PAYOUTS, { exigido: CON_PAYOUTS });

// El host que se imprime es EXACTAMENTE el que usan los clientes (misma fuente).
const baseCobros = wompiClient.baseUrl;
const basePayouts = wompiPayoutsClient.baseUrl;

console.log('\nHosts que se usarán:');
console.log(`  cobros     → ${baseCobros}`);
console.log(`  payouts    → ${basePayouts}`);

const cobrosEsSandbox = baseCobros.includes('sandbox');

if (esProduccion && cobrosEsSandbox) {
  console.log('\n  ✗ DESAJUSTE: las llaves son de PRODUCCIÓN pero el host es SANDBOX.');
  console.log('      Wompi responde 422 "Formato inválido". Usa --prod, o exporta');
  console.log('      WOMPI_BASE_URL=https://production.wompi.co/v1 y NODE_ENV=production.');
  fallos++;
} else if (esProduccion) {
  console.log('\n  ⚠️  ATENCIÓN: las llaves y el host son de PRODUCCIÓN.');
  console.log('      Un cobro aquí mueve dinero real. Verifica primero en sandbox');
  console.log('      (llaves pub_test_/prv_test_), que es gratis y va por otro host.');
}

// ── Comprobaciones locales (sin red) ────────────────────────────────────────

console.log('\nComprobaciones locales:');

// La firma de integridad es puro cálculo: si el secreto está, produce hex válido.
if (process.env.WOMPI_INTEGRITY_SECRET) {
  try {
    const firma = wompiClient.createIntegritySignature({
      reference: 'VERIFICACION-LOCAL',
      amountInCents: 100000,
      currency: 'COP'
    });
    const esHex64 = /^[0-9a-f]{64}$/.test(firma);
    console.log(`  ${esHex64 ? '✓' : '✗'} firma de integridad se calcula (SHA256 hex de 64)`);
    if (!esHex64) fallos++;
  } catch (e) {
    console.log(`  ✗ firma de integridad falló: ${e.message}`);
    fallos++;
  }
  console.log('    · el valor de la firma NO se puede validar contra Wompi sin crear');
  console.log('      una transacción real; el webhook y el widget sí la validarán.');
} else {
  console.log('  · firma de integridad: sin secreto, no se puede calcular');
}

// Verificación del checksum de eventos con un evento sintético y el secreto real.
if (process.env.WOMPI_EVENTS_SECRET) {
  const evento = {
    event: 'transaction.updated',
    data: { transaction: { id: 'a', status: 'APPROVED', amount_in_cents: 1 } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
    timestamp: 1
  };
  const crypto = require('crypto');
  const valores = evento.signature.properties
    .map((r) => r.split('.').reduce((a, k) => a[k], evento.data))
    .join('');
  evento.signature.checksum = crypto
    .createHash('sha256')
    .update(`${valores}${evento.timestamp}${process.env.WOMPI_EVENTS_SECRET}`)
    .digest('hex');

  const propio = wompiClient.verifyEventChecksum(evento);
  const ajeno = wompiClient.verifyEventChecksum({ ...evento, timestamp: 2 });
  const bien = propio.valid === true && ajeno.valid === false;
  console.log(`  ${bien ? '✓' : '✗'} verificación de eventos: acepta el suyo y rechaza el alterado`);
  if (!bien) fallos++;
}

// ── Comprobaciones en vivo (solo LECTURA) ───────────────────────────────────

async function comprobarEnVivo() {
  console.log('\nComprobaciones en vivo (solo GET, no se cobra ni se dispersa nada):');

  if (process.env.WOMPI_PUBLIC_KEY) {
    try {
      const { acceptanceToken, permalink } = await wompiClient.getAcceptanceTokens();
      console.log(`  ✓ llave pública válida: Wompi devolvió token de aceptación (${acceptanceToken.length} car.)`);
      if (permalink) console.log(`    · permalink de términos: ${permalink}`);
    } catch (e) {
      console.log(`  ✗ la llave pública fue rechazada: ${e.status || ''} ${e.message}`);
      fallos++;
    }
  } else {
    console.log('  · llave pública ausente: se omite');
  }

  if (!CON_PAYOUTS) {
    console.log('  · dispersiones: se omiten (usa --payouts para comprobarlas)');
    return;
  }
  if (!wompiPayoutsClient.isConfigured()) {
    console.log('  · dispersiones sin configurar: se omite');
    return;
  }

  try {
    const bancos = await wompiPayoutsClient.listBanks({ force: true });
    console.log(`  ✓ credenciales de dispersión válidas: ${bancos.length} bancos en el catálogo`);
    console.log('    · coteja los bancos que ofrece la app contra este catálogo:');
    for (const b of bancos) console.log(`        ${b.name}  →  ${b.id}`);
  } catch (e) {
    console.log(`  ✗ el catálogo de bancos falló: ${e.status || ''} ${e.message}`);
    fallos++;
    return;
  }

  try {
    const cuentas = await wompiPayoutsClient.listAccounts();
    const coincide = cuentas.some((c) => (c.id || c.account_id) === process.env.WOMPI_PAYOUTS_ACCOUNT_ID);
    console.log(`  ${coincide ? '✓' : '⚠️'} cuentas de origen: ${cuentas.length} disponibles` +
      (coincide ? ' y el ACCOUNT_ID configurado está entre ellas' : ' — el ACCOUNT_ID configurado NO aparece'));
    if (!coincide) fallos++;
  } catch (e) {
    console.log(`  ✗ no se pudieron listar las cuentas de origen: ${e.status || ''} ${e.message}`);
    fallos++;
  }
}

(async () => {
  if (LIVE) {
    await comprobarEnVivo();
  } else {
    console.log('\n(Usa --live para comprobar las llaves contra Wompi, solo con GETs de lectura.)');
  }

  console.log(
    fallos === 0
      ? '\n══ Sin problemas detectados ══'
      : `\n══ ${fallos} problema(s) detectado(s) ══`
  );
  process.exit(fallos === 0 ? 0 : 1);
})();
