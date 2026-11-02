const { execSync } = require('child_process');
const path = require('path');

const patterns = [
  'geminiService',
  'geminiFallback',
  'auraToolExecutor',
  'contract',
  'biometric',
  'resilience',
  'contextCompressor',
  'fase5',
  'api.cors'
];

const allOutput = execSync('npx jest --listTests', { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
const allTests = allOutput.trim().split('\n').map(s => s.trim()).filter(Boolean);

console.log(`📊 TOTAL SUITES REGISTRADAS EN JEST: ${allTests.length}`);

const patternMatches = {};
patterns.forEach(p => {
  const matches = allTests.filter(t => t.includes(p));
  patternMatches[p] = matches;
});

console.log('\n🔍 DESGLOSE PATRÓN POR PATRÓN (9 PATRONES ACTIVOS):');
patterns.forEach(p => {
  console.log(`- "${p}": ${patternMatches[p].length} coincidencia(s)`);
  patternMatches[p].forEach(m => console.log(`    • ${path.basename(m)}`));
});

const ignorePatternStr = patterns.join('|');
const gateOutput = execSync(`npx jest --listTests --testPathIgnorePatterns="${ignorePatternStr}"`, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
const gateTests = gateOutput.trim().split('\n').map(s => s.trim()).filter(Boolean);

const excludedTests = allTests.filter(t => !gateTests.includes(t));

console.log(`\n✅ REPARTO DE SUITES PARA EL GATE:`);
console.log(`- Dentro del Gate (bloqueante): ${gateTests.length} de ${allTests.length} suites`);
console.log(`- Excluidas del Gate (no bloqueantes): ${excludedTests.length} de ${allTests.length} suites`);
console.log(`\nLista de suites excluidas (${excludedTests.length}):`);
excludedTests.forEach(t => console.log(`  • ${path.basename(t)}`));
