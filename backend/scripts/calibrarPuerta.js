#!/usr/bin/env node
// backend/scripts/calibrarPuerta.js
//
// Corre EN TU MÁQUINA: mide la puerta de calidad sobre una carpeta de fotos y escribe
// un CSV. Las imágenes no se suben a ningún sitio ni se copian: se leen, se miden y se
// olvidan. Lo único que sale de aquí es el CSV.
//
// Uso:
//   node scripts/calibrarPuerta.js "C:/ruta/a/capturas"
//   node scripts/calibrarPuerta.js "C:/ruta/a/capturas" --out informe.csv
//
// Por qué existe: para calibrar los umbrales hacen falta decenas de caras reales, y esas
// caras son datos personales. El número (brillo, nitidez, tamaño) sirve para calibrar;
// la imagen no hace falta que viaje para nada.

const fs = require('fs');
const path = require('path');
const { assessQuality } = require('../src/services/biometric/captureQuality.service');

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

function csvCampo(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

async function main() {
  const args = process.argv.slice(2);
  const carpeta = args.find((a) => !a.startsWith('--'));
  const outIndex = args.indexOf('--out');
  const salida = outIndex >= 0 ? args[outIndex + 1] : path.join(carpeta || '.', 'informe-puerta.csv');

  if (!carpeta || !fs.existsSync(carpeta)) {
    console.error('Falta la carpeta. Uso: node scripts/calibrarPuerta.js "C:/ruta/capturas"');
    process.exit(1);
  }

  const archivos = fs.readdirSync(carpeta)
    .filter((f) => EXTENSIONES.has(path.extname(f).toLowerCase()))
    .sort();

  if (archivos.length === 0) {
    console.error(`No hay imágenes en ${carpeta}`);
    process.exit(1);
  }

  const filas = [];
  const porVeredicto = { ACEPTADA: 0, REVISAR: 0, RECHAZADA: 0, ERROR: 0 };
  const porMotivo = {};

  for (const archivo of archivos) {
    try {
      const buffer = fs.readFileSync(path.join(carpeta, archivo));
      const r = await assessQuality(buffer);
      const m = r.metrics || {};
      const motivos = (r.reasons || []).map((x) => `${x.code}:${x.metric}`).join(' | ');

      porVeredicto[r.verdict] = (porVeredicto[r.verdict] || 0) + 1;
      for (const motivo of r.reasons || []) {
        porMotivo[motivo.code] = (porMotivo[motivo.code] || 0) + 1;
      }

      filas.push({
        archivo,
        ancho: m.width,
        alto: m.height,
        luminancia: m.luminance,
        nitidez: m.sharpness,
        veredicto: r.verdict,
        puntaje: r.score,
        motivos,
      });
    } catch (e) {
      porVeredicto.ERROR += 1;
      filas.push({ archivo, veredicto: 'ERROR', motivos: e.message });
    }
  }

  const cabecera = ['archivo', 'ancho', 'alto', 'luminancia', 'nitidez', 'veredicto', 'puntaje', 'motivos'];
  const lineas = [cabecera.join(',')];
  for (const f of filas) {
    lineas.push(cabecera.map((k) => csvCampo(f[k])).join(','));
  }
  fs.writeFileSync(salida, lineas.join('\n') + '\n', 'utf8');

  console.log(`\n${filas.length} imágenes medidas → ${salida}\n`);
  console.log('Veredictos:', JSON.stringify(porVeredicto));
  if (Object.keys(porMotivo).length) {
    console.log('Motivos:', JSON.stringify(porMotivo));
  }
  const validas = filas.filter((f) => f.veredicto !== 'ERROR');
  if (validas.length) {
    const lum = validas.map((f) => f.luminancia).filter(Number.isFinite);
    const nit = validas.map((f) => f.nitidez).filter(Number.isFinite);
    const rango = (arr) => (arr.length
      ? `min ${Math.min(...arr).toFixed(1)} · mediana ${[...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)].toFixed(1)} · max ${Math.max(...arr).toFixed(1)}`
      : 'sin datos');
    console.log(`Brillo: ${rango(lum)}`);
    console.log(`Nitidez: ${rango(nit)}`);
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
