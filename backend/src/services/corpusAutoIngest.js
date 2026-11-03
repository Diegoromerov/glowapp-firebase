/**
 * corpusAutoIngest.js
 * Auto-ingesta de corpus JSON en cada deploy.
 * Escanea backend/data/corpus/*.json, compara hash MD5 contra el manifest
 * y ejecuta scripts/ingest_json_chunks.js solo para archivos nuevos o cambiados.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CORPUS_DIR = path.join(__dirname, '..', '..', 'data', 'corpus');
const INGEST_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ingest_json_chunks.js');

let ragPool = null;
try { ragPool = require('../config/db').ragPool; } catch (e) { ragPool = null; }

const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\r\\n\\t]+', 'g');

function md5(text) { return crypto.createHash('md5').update(text, 'utf8').digest('hex'); }

function parseTolerant(raw) {
  const sinBom = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  try { JSON.parse(sinBom); return true; }
  catch (e1) {
    try { JSON.parse(sinBom.replace(CTRL_RE, ' ')); return true; }
    catch (e2) { return false; }
  }
}

async function ensureManifestTable() {
  await ragPool.query(
    'CREATE TABLE IF NOT EXISTS corpus_ingest_manifest (' +
    ' filename TEXT PRIMARY KEY,' +
    ' file_hash TEXT,' +
    ' status TEXT,' +
    ' detail TEXT,' +
    ' ingested_at TIMESTAMPTZ DEFAULT NOW()' +
    ' );'
  );
}

async function upsertManifest(filename, hash, status, detail) {
  try {
    await ragPool.query(
      'INSERT INTO corpus_ingest_manifest (filename, file_hash, status, detail, ingested_at) ' +
      'VALUES ($1, $2, $3, $4, NOW()) ' +
      'ON CONFLICT (filename) DO UPDATE SET file_hash = EXCLUDED.file_hash, ' +
      'status = EXCLUDED.status, detail = EXCLUDED.detail, ingested_at = NOW();',
      [filename, hash, status, detail]
    );
  } catch (e) { /* el manifest no es crítico */ }
}

function runIngest(filePath) {
  return new Promise((resolve) => {
    execFile(process.execPath, [INGEST_SCRIPT, filePath], { timeout: 15 * 60 * 1000 }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function startCorpusAutoIngest() {
  try {
    if (!ragPool) { console.warn('⚠️ Auto-ingest: ragPool no disponible, se omite.'); return; }
    if (!fs.existsSync(CORPUS_DIR)) { console.log(' Auto-ingest: sin carpeta data/corpus, se omite.'); return; }

    await ensureManifestTable();
    const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json')).sort();
    if (files.length === 0) return;

    console.log('🏭 Auto-ingest: ' + files.length + ' archivos de corpus detectados.');

    for (const file of files) {
      const fullPath = path.join(CORPUS_DIR, file);
      let raw;
      try { raw = fs.readFileSync(fullPath, 'utf8'); } catch (e) { continue; }
      const hash = md5(raw);

      if (!parseTolerant(raw)) {
        console.warn('⚠️ Auto-ingest: ' + file + ' tiene JSON inválido, se omite.');
        await upsertManifest(file, hash, 'error_json_invalido', 'JSON no parseable');
        continue;
      }

      const prev = await ragPool.query('SELECT file_hash, status FROM corpus_ingest_manifest WHERE filename = $1', [file]);
      if (prev.rows.length > 0 && prev.rows[0].file_hash === hash && prev.rows[0].status === 'ok') {
        continue;
      }

      console.log('🏭 Auto-ingest: procesando ' + file + '...');
      const result = await runIngest(fullPath);
      const tail = result.stdout.split('\n').slice(-8).join('\n');
      if (result.code === 0) {
        await upsertManifest(file, hash, 'ok', '');
        console.log('✅ Auto-ingest: ' + file + ' completado.\n' + tail);
      } else {
        await upsertManifest(file, hash, 'error', (result.stderr || result.stdout).substring(0, 200));
        console.error('❌ Auto-ingest: ' + file + ' falló.\n' + tail);
      }
    }
    console.log('🏭 Auto-ingest: revisión completa.');
  } catch (e) {
    console.error('❌ Auto-ingest error global:', e.message);
  }
}

module.exports = { startCorpusAutoIngest };

if (require.main === module) {
  startCorpusAutoIngest().then(() => process.exit(0));
}