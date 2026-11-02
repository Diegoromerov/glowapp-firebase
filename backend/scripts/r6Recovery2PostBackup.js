require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { ragPool } = require('../src/config/db');

const BACKUP_PATH = './R6_RECOVERY2_POST_REBUILD.sql';

async function main() {
  const url = process.env.RAG_DATABASE_URL || '';
  if (!(url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0'))) {
    console.error('PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }

  console.log('=== POST-BACKUP ===');
  const res = await ragPool.query('SELECT * FROM beauty_knowledge_embeddings ORDER BY id');
  const rows = res.rows;
  const nonNullCount = rows.filter(r => r.embedding !== null).length;

  let sql = '-- R6-RECOVERY-2 POST-REBUILD BACKUP\n';
  sql += '-- timestamp: ' + new Date().toISOString() + '\n';
  sql += '-- rows: ' + rows.length + '\n';
  sql += '-- non-nulls: ' + nonNullCount + '\n\n';
  sql += 'TRUNCATE TABLE beauty_knowledge_embeddings RESTART IDENTITY CASCADE;\n\n';

  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = cols.map(c => {
      const v = row[c];
      if (v === null) return 'NULL';
      if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
      if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
      if (Array.isArray(v)) return '[' + v.join(',') + ']';
      return v;
    });
    sql += 'INSERT INTO beauty_knowledge_embeddings (' + cols.join(', ') + ') VALUES (' + vals.join(', ') + ');\n';
  }

  fs.writeFileSync(BACKUP_PATH, sql);
  const hash = crypto.createHash('sha256').update(sql).digest('hex').substring(0, 16);
  const stats = fs.statSync(BACKUP_PATH);

  console.log('POST-BACKUP:', BACKUP_PATH);
  console.log('SIZE:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('SHA256:', hash);
  console.log('ROWS:', rows.length);
  console.log('NON-NULLS:', nonNullCount);
  console.log('POST-BACKUP: COMPLETE');

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });