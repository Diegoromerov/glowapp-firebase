#!/usr/bin/env node
/**
 * reencryptBiometricData.js — Re-cifra los datos biométricos que quedaron cifrados con
 * la clave LEGADA (derivada de JWT_SECRET) para que sigan siendo legibles después de
 * provisionar BIOMETRIC_ENCRYPTION_KEY (A360-2026-09-22/C-11).
 *
 * Por defecto corre en modo DRY-RUN: no escribe nada, solo mide.
 *
 *   node scripts/reencryptBiometricData.js                      # dry-run (seguro)
 *   node scripts/reencryptBiometricData.js --apply              # re-cifra filas legadas
 *   node scripts/reencryptBiometricData.js --apply --encrypt-plain  # re-cifra también objetos en claro
 *
 * OBJETIVOS VERIFICADOS CONTRA ESQUEMA Y MIGRACIONES:
 *   1. beauty_profiles.face_scores (JSONB)
 *   2. beauty_profiles.hands_diagnosis (JSONB)
 *   3. biometric_history.face_scores (JSONB)
 *   4. biometric_history.hands_diagnosis (JSONB)
 *   5. glow_cycle_measurements.encrypted_scores (TEXT)
 */
const path = require('path');
const { pool, testConnection } = require(path.join(__dirname, '../src/config/db'));
const crypto = require('../src/services/biometricCryptoService');

const APLICAR = process.argv.includes('--apply');
const REENCRYPT_PLAIN = process.argv.includes('--encrypt-plain');

const OBJETIVOS = [
  { tabla: 'beauty_profiles', columna: 'face_scores', isJsonb: true },
  { tabla: 'beauty_profiles', columna: 'hands_diagnosis', isJsonb: true },
  { tabla: 'biometric_history', columna: 'face_scores', isJsonb: true },
  { tabla: 'biometric_history', columna: 'hands_diagnosis', isJsonb: true },
  { tabla: 'glow_cycle_measurements', columna: 'encrypted_scores', isJsonb: false },
];

async function procesar(target, aplicarOverride = null, reencryptPlainOverride = null) {
  const aplicar = aplicarOverride !== null ? aplicarOverride : APLICAR;
  const reencryptPlain = reencryptPlainOverride !== null ? reencryptPlainOverride : REENCRYPT_PLAIN;
  const { tabla, columna, isJsonb } = target;
  let res;
  try {
    res = await pool.query(
      `SELECT id, ${columna}::text AS cifrado FROM ${tabla} WHERE ${columna} IS NOT NULL`
    );
  } catch (err) {
    throw new Error(`Error al leer ${tabla}.${columna}: ${err.message}`);
  }

  const filas = res.rows;
  let legados = 0, migrados = 0, ilegibles = 0, sinCifrar = 0;

  for (const fila of filas) {
    let strCifrado = typeof fila.cifrado === 'string' ? fila.cifrado.trim() : '';
    if (!strCifrado || strCifrado === 'null' || strCifrado === '""') continue;

    // Detectar si la columna almacena un objeto o array JSON sin cifrar (jsonb_typeof = 'object' / 'array')
    let parsedObj = null;
    let isPlainObject = false;
    try {
      parsedObj = JSON.parse(strCifrado);
      if (parsedObj !== null && typeof parsedObj === 'object') {
        isPlainObject = true;
      }
    } catch (_) {}

    if (isPlainObject) {
      sinCifrar++;
      if (aplicar && reencryptPlain) {
        const nuevoCipher = crypto.encrypt(parsedObj);
        if (isJsonb) {
          await pool.query(
            `UPDATE ${tabla} SET ${columna} = to_jsonb($1::text) WHERE id = $2`,
            [nuevoCipher, fila.id]
          );
        } else {
          await pool.query(
            `UPDATE ${tabla} SET ${columna} = $1 WHERE id = $2`,
            [nuevoCipher, fila.id]
          );
        }
        migrados++;
      }
      continue;
    }

    // Des-envolver comillas de JSON string si vienen del cast ::text en columnas JSONB
    if (strCifrado.startsWith('"') && strCifrado.endsWith('"')) {
      try {
        strCifrado = JSON.parse(strCifrado);
      } catch (_) {}
    }

    let claro = null;
    let esLegado = false;

    // 1) ¿Lo descifra la clave ACTUAL? No requiere re-cifrado.
    try {
      claro = crypto.decrypt(strCifrado);
    } catch (_) {
      esLegado = true;
      // 2) Intentar descifrar con la clave LEGADA
      try {
        claro = crypto.decryptWithLegacyKey(strCifrado);
      } catch (legacyErr) {
        ilegibles++;
        continue;
      }
    }

    if (!esLegado || claro === null) continue;

    legados++;
    if (aplicar) {
      const nuevoCipher = crypto.encrypt(claro);
      if (isJsonb) {
        await pool.query(
          `UPDATE ${tabla} SET ${columna} = to_jsonb($1::text) WHERE id = $2`,
          [nuevoCipher, fila.id]
        );
      } else {
        await pool.query(
          `UPDATE ${tabla} SET ${columna} = $1 WHERE id = $2`,
          [nuevoCipher, fila.id]
        );
      }
      migrados++;
    }
  }

  return { tabla, columna, total: filas.length, legados, migrados, ilegibles, sinCifrar };
}

async function main() {
  console.log(`\n🔐 Re-cifrado de datos biométricos — modo ${APLICAR ? 'APPLY (escribe)' : 'DRY-RUN (no escribe)'}`);
  console.log(`   Huella de la clave activa: ${crypto.keyFingerprint()}\n`);

  const conectado = await testConnection();
  if (!conectado) {
    console.error('❌ Sin conexión a la base de datos. Abortado.');
    process.exit(1);
  }

  let totalLegados = 0, totalIlegibles = 0, totalMigrados = 0, totalSinCifrar = 0;
  let errores = [];

  for (const target of OBJETIVOS) {
    try {
      const r = await procesar(target);
      totalLegados += r.legados;
      totalIlegibles += r.ilegibles;
      totalMigrados += r.migrados;
      totalSinCifrar += r.sinCifrar;
      console.log(`   ${r.tabla}.${r.columna}: ${r.total} filas · clave legada: ${r.legados} · sin cifrar (JSON object): ${r.sinCifrar} · migradas: ${r.migrados} · ilegibles: ${r.ilegibles}`);
    } catch (err) {
      console.error(`   ❌ FAIL-CLOSED en ${target.tabla}.${target.columna}: ${err.message}`);
      errores.push(err.message);
    }
  }

  if (errores.length > 0) {
    console.error(`\n❌ SCRIPT ABORTADO CON ERROR (${errores.length} objetivos ilegibles/fallidos).`);
    process.exit(1);
  }

  console.log(`\n   TOTAL: ${totalLegados} clave legada, ${totalSinCifrar} sin cifrar (JSON object), ${totalIlegibles} ilegibles, ${totalMigrados} migrados.`);
  if (!APLICAR) {
    console.log('   (dry-run) Repite con --apply para escribir los cambios de clave legada.\n');
  } else {
    console.log('   ✅ Re-cifrado aplicado. Verifica con el mismo comando en dry-run: debe dar 0 legados.\n');
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Error no controlado en el re-cifrado:', err);
    process.exit(1);
  });
}

module.exports = { procesar, OBJETIVOS, main };
