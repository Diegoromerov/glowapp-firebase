const { searchBeautyKnowledge } = require('./src/services/ragService');

const tests = [
  'piel grasa acné',
  'rutina piel seca',
  'bakuchiol embarazo',
  'vitamina C niacinamida',
  'protector solar melasma',
  'retinol purge',
  'acido hialuronico uso'
];

async function run() {
  const results = [];
  for (const q of tests) {
    const r = await searchBeautyKnowledge(q, { topK: 5, threshold: 0.72 });
    results.push({
      q,
      chunks: r.length,
      topSim: r[0]?.similarity || 0,
      skins: [...new Set(r.map(c => c.skinType).filter(Boolean))],
      titles: r.map(c => c.title.substring(0,40))
    });
  }
  
  console.log('=== BASELINE PRE-FIX ===');
  
  for (const r of results) {
    console.log('Query: ' + r.q.substring(0,22) + ' | Chunks: ' + r.chunks + ' | TopSim: ' + r.topSim + ' | SkinTypes: ' + (r.skins.join(',') || 'N/A'));
  }
  
  const ok = results.every(r => r.chunks >= 3 && r.topSim > 0.7);
  console.log('\n' + (ok ? '[PASS]' : '[FAIL]') + ' - Baseline guardado');
  
  const fs = require('fs');
  const cp = require('child_process');
  let commitHash = 'unknown';
  try {
    commitHash = cp.execSync('git rev-parse HEAD').toString().trim();
  } catch (e) {
    commitHash = 'unknown';
  }
  
  fs.writeFileSync('baseline_pre_fix.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    commit: commitHash,
    results,
    passed: ok
  }, null, 2));
  console.log('Guardado: baseline_pre_fix.json');
}

run().catch(console.error);
