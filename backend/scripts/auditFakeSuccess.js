const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function scanFileForFakeSuccess(filePath, rootDir) {
  const relPath = path.relative(rootDir, filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const findings = [];
  let inCatch = false;
  let catchStartLine = 0;
  let catchBraceDepth = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    if (trimmed.includes('catch') && trimmed.includes('{')) {
      inCatch = true;
      catchStartLine = lineNum;
      catchBraceDepth = 1;
    }

    if (inCatch) {
      // Detección de patrones que fingen éxito en bloques catch
      if (
        trimmed.includes('res.status(200)') ||
        trimmed.includes('status: 200') ||
        (trimmed.includes('success: true') && !trimmed.includes('//')) ||
        (trimmed.includes('res.json(') && !trimmed.includes('error') && !trimmed.includes('500') && !trimmed.includes('503') && !trimmed.includes('400') && !trimmed.includes('401') && !trimmed.includes('403') && !trimmed.includes('404'))
      ) {
        let veredicto = 'finge';
        let explicacion = 'Retorna respuesta de éxito (200 o success: true) dentro de un bloque catch';

        // Casos legítimos con aviso (ej. fallbacks explícitos para polling o mocks conocidos)
        if (trimmed.includes('fallback') || trimmed.includes('degraded') || relPath.includes('test')) {
          veredicto = 'legítimo con aviso';
          explicacion = 'Fallback de resiliencia o prueba unitaria';
        }

        findings.push({
          archivo: relPath.replace(/\\/g, '/'),
          linea: lineNum,
          codigo: trimmed,
          veredicto,
          explicacion
        });
      }

      if (trimmed.includes('{')) catchBraceDepth++;
      if (trimmed.includes('}')) catchBraceDepth--;
      if (catchBraceDepth <= 0) {
        inCatch = false;
      }
    }
  });

  return findings;
}

function runAudit() {
  console.log('🔍 Ejecutando auditoría de barrido de éxitos falsos (A1.T4)...');
  const rootDir = path.resolve(__dirname, '../..');
  
  const filesToScan = [
    ...fs.readdirSync(path.join(rootDir, 'backend/src/controllers')).map(f => path.join(rootDir, 'backend/src/controllers', f)),
    ...fs.readdirSync(path.join(rootDir, 'backend/src/routes')).map(f => path.join(rootDir, 'backend/src/routes', f)),
    path.join(rootDir, 'backend/index.js')
  ].filter(f => fs.existsSync(f) && fs.statSync(f).isFile() && f.endsWith('.js'));

  const allFindings = [];
  filesToScan.forEach(f => {
    const findings = scanFileForFakeSuccess(f, rootDir);
    allFindings.push(...findings);
  });

  const docsDir = path.join(rootDir, 'docs/audit');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'fake-success-2026-09-24.json');
  fs.writeFileSync(outputPath, JSON.stringify(allFindings, null, 2), 'utf-8');

  console.log(`✅ Auditoría completada. Se encontraron ${allFindings.length} patrones evaluados.`);
  console.log(`📄 Reporte guardado en: ${outputPath}`);
}

runAudit();
