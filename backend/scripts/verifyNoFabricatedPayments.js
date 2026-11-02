#!/usr/bin/env node
/**
 * verifyNoFabricatedPayments.js
 *
 * Guard anti-fabricación en la ruta del dinero.
 *
 * Existe porque el 22-sep-2026 se verificó que la app "cobraba" sin cobrar en
 * tres sitios distintos: un `success: true` local en Flutter, un temporizador
 * que ejecutaba `onSuccess()` sin llamar a nadie, y un pedido que nacía con
 * estado 'PAGADO' escrito a mano en el INSERT del backend (pisando el
 * DEFAULT 'PENDIENTE_PAGO' del esquema).
 *
 * Nació en ROJO a propósito: un guard que arranca verde no demuestra que
 * detecte nada. Se pone verde cuando la fabricación desaparece.
 *
 * Uso:  node scripts/verifyNoFabricatedPayments.js        (exit 1 si hay fakes)
 *       node scripts/verifyNoFabricatedPayments.js --list (solo lista, exit 0)
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const BACKEND_SRC = path.join(RAIZ, 'backend', 'src');
const FLUTTER_LIB = path.join(RAIZ, 'frontend', 'lib');

const soloListar = process.argv.includes('--list');

function recorrer(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', '.dart_tool'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');
const lineas = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/);

const hallazgos = [];
const marcar = (archivo, linea, regla, texto) =>
  hallazgos.push({ archivo: rel(archivo), linea, regla, texto: texto.trim().slice(0, 110) });

// Un comentario que MENCIONA un patrón no es el patrón: los comentarios que
// documentan un arreglo no deben hacer fallar el guard.
const esComentario = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

// ─────────────────────────────────────────────────────────────────────────────
// R1 · Un pedido no puede nacer marcado como pagado en el INSERT.
//      El estado debe venir del DEFAULT del esquema ('PENDIENTE_PAGO').
// ─────────────────────────────────────────────────────────────────────────────
for (const f of recorrer(BACKEND_SRC, /\.js$/)) {
  const ls = lineas(f);
  ls.forEach((l, i) => {
    if (esComentario(l)) return;
    if (!/['"]PAGADO['"]|['"]paid['"]/.test(l)) return;
    const contexto = ls.slice(Math.max(0, i - 5), i).join(' ');
    const esInsertDePedido = /INSERT\s+INTO\s+pedidos_tienda/i.test(contexto + ' ' + l);
    const esAsignacionDePago = /payment_status\s*=|estado\s*=/i.test(l) && /['"](paid|PAGADO)['"]/i.test(l);
    if (esInsertDePedido || esAsignacionDePago) {
      marcar(f, i + 1, 'R1 estado pagado escrito a mano', l);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 · Referencia de pasarela inventada localmente.
// ─────────────────────────────────────────────────────────────────────────────
for (const f of recorrer(BACKEND_SRC, /\.js$/)) {
  const ls = lineas(f);
  const texto = ls.join('\n');
  if (!/Math\.random\(\)/.test(texto)) continue;
  if (!/wompi|payment|transaction|pago/i.test(texto)) continue;
  ls.forEach((l, i) => {
    if (esComentario(l)) return;
    if (/Math\.random\(\)/.test(l) && /ref|token|referencia|external/i.test(l)) {
      marcar(f, i + 1, 'R2 referencia de pasarela inventada con Math.random', l);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// R3 · Transición a pagado/confirmado inmediatamente después de un retardo
//      artificial: es un temporizador haciendo de pasarela.
// ─────────────────────────────────────────────────────────────────────────────
const VENTANA = 8;
for (const f of [...recorrer(BACKEND_SRC, /\.js$/), ...recorrer(FLUTTER_LIB, /\.dart$/)]) {
  const ls = lineas(f);
  ls.forEach((l, i) => {
    if (esComentario(l)) return;
    if (!/(setTimeout|Future\.delayed)\(/.test(l)) return;
    const bloque = ls.slice(i, i + VENTANA).join('\n');
    const afirmaPago =
      /(status|estado|payment_status)\s*[:=]\s*(['"]?(paid|APPROVED|PAGADO|CONFIRMADA))/i.test(bloque) ||
      /['"]success['"]\s*:\s*true/.test(bloque) ||
      /onSuccess\(/.test(bloque);
    if (afirmaPago) {
      marcar(f, i + 1, 'R3 retardo artificial + afirmación de pago', l);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 · La hoja de pago no puede resolver por sí sola un cobro de tienda.
// ─────────────────────────────────────────────────────────────────────────────
for (const f of recorrer(FLUTTER_LIB, /\.dart$/)) {
  const ls = lineas(f);
  ls.forEach((l, i) => {
    if (esComentario(l)) return;
    if (/STORE_/.test(l) && /startsWith|bookingId/.test(l)) {
      marcar(f, i + 1, 'R4 identidad de tienda tratada como si fuera una cita pagable', l);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// R5 · Asignación de estado por defecto en transacciones con fallback (|| o ??).
// ─────────────────────────────────────────────────────────────────────────────
for (const f of recorrer(BACKEND_SRC, /\.js$/)) {
  const ls = lineas(f);
  ls.forEach((l, i) => {
    if (esComentario(l)) return;
    if (/(status|estado|payment_status)\s*[:=]\s*.*(\||\|\/|\?\?)\s*['"]?(APPROVED|PAGADO|paid|CONFIRMADA)['"]?/i.test(l)) {
      marcar(f, i + 1, 'R5 fallback de estado por defecto en transacción', l);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Salida
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Supresión declarada
//
// Un simulador de desarrollo es legítimo SI está declarado y SI el archivo
// demuestra disciplina de entorno (menciona NODE_ENV). El marcador por sí solo
// no basta: sin la comprobación de entorno el hallazgo se sigue reportando, así
// que no se puede silenciar un fake escribiendo un comentario.
// Los suprimidos se imprimen igual: nada se esconde.
// ─────────────────────────────────────────────────────────────────────────────
const MARCADOR = 'guard-allow-simulacion';
const cache = new Map();
const activos = hallazgos.filter((h) => {
  if (!cache.has(h.archivo)) {
    cache.set(h.archivo, fs.readFileSync(path.join(RAIZ, h.archivo), 'utf8'));
  }
  const texto = cache.get(h.archivo);
  return !(texto.includes(MARCADOR) && /NODE_ENV/.test(texto));
});
const suprimidos = hallazgos.filter((h) => !activos.includes(h));

if (suprimidos.length > 0) {
  console.log(`\nℹ️  ${suprimidos.length} hallazgo(s) suprimido(s) por simulador declarado con comprobación de entorno:`);
  for (const h of suprimidos) console.log(`     ${h.archivo}:${h.linea}  [${h.regla}]`);
}

if (activos.length === 0) {
  console.log('✅ Sin fabricación de pagos: no quedó ningún patrón prohibido sin declarar.');
  process.exit(0);
}

console.log(`\n🚨 FABRICACIÓN DE PAGOS DETECTADA — ${activos.length} hallazgo(s)\n`);
for (const h of activos) {
  console.log(`  ${h.archivo}:${h.linea}`);
  console.log(`     [${h.regla}]`);
  console.log(`     ${h.texto}`);
}
console.log('\nLa ruta del dinero debe ser real o mostrar error. Nada de éxito local.\n');
process.exit(soloListar ? 0 : 1);
