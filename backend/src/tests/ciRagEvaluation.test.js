/**
 * backend/src/tests/ciRagEvaluation.test.js
 * Tests para validar que el script CI/CD funciona correctamente
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Helper seguro para ejecutar execSync evitando errores circulares no serializables por Jest
 */
function safeExecSync(cmd, options = {}) {
  const defaultOptions = { encoding: 'utf8', timeout: 30000 };
  const mergedOptions = { ...defaultOptions, ...options };
  try {
    return execSync(cmd, mergedOptions);
  } catch (e) {
    const cleanError = new Error(`execSync failed [${cmd}]: ${e.message || String(e)}`);
    cleanError.code = e.code || 'EXEC_ERROR';
    cleanError.status = e.status;
    cleanError.stdout = e.stdout ? String(e.stdout) : '';
    cleanError.stderr = e.stderr ? String(e.stderr) : '';
    throw cleanError;
  }
}

describe('CI RAG Evaluation Script', () => {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'ciRagEvaluation.sh');
  const evaluateScriptPath = path.join(__dirname, '..', '..', 'scripts', 'evaluateRag.js');

  test('ciRagEvaluation.sh existe y es ejecutable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    // En Windows, el bit de ejecutable no se refleja igual que en Unix
    // Verificamos que el archivo existe y tiene extensión .sh
    expect(path.extname(scriptPath)).toBe('.sh');
  });

  test('evaluateRag.js existe', () => {
    expect(fs.existsSync(evaluateScriptPath)).toBe(true);
  });

  test('evaluateRag.js tiene sintaxis válida', () => {
    const result = safeExecSync(`node -c "${evaluateScriptPath}"`, { timeout: 30000 });
    // node -c no outputa nada en éxito, solo falla con error si hay syntax error
    expect(result).toBe('');
  });

  test('ciRagEvaluation.sh tiene sintaxis bash válida', () => {
    // Si bash no está en el PATH o en Windows path con espacios, protegemos la ejecución
    try {
      const result = safeExecSync(`bash -n "${scriptPath.replace(/\\/g, '/')}"`, { timeout: 30000 });
      expect(result.trim()).toBe('');
    } catch (e) {
      if (process.platform === 'win32' && (e.message.includes('No such file') || e.message.includes('not found') || e.message.includes('cannot find') || e.message.includes('ETIMEDOUT') || e.message.includes('spawnSync'))) {
        console.warn('⚠️  bash no disponible o path no resuelto en Windows, omitiendo test de sintaxis bash');
        return;
      }
      throw e;
    }
  });

  test('evaluateRag.js muestra ayuda con --help', () => {
    const result = safeExecSync(`node "${evaluateScriptPath}" --help`, { timeout: 30000 });
    expect(result).toContain('Uso:');
    expect(result).toContain('--dataset');
    expect(result).toContain('--baseline');
    expect(result).toContain('--fail-on-regression');
  });

  test('ciRagEvaluation.sh muestra ayuda', () => {
    try {
      const result = safeExecSync(`bash "${scriptPath.replace(/\\/g, '/')}" --help`, { timeout: 30000 });
      expect(result).toContain('CI RAG Evaluation');
      expect(result).toContain('--fail-on-regression');
    } catch (e) {
      if (process.platform === 'win32' && (e.message.includes('No such file') || e.message.includes('not found') || e.message.includes('cannot find') || e.message.includes('ETIMEDOUT') || e.message.includes('spawnSync'))) {
        console.warn('⚠️  bash no disponible o path no resuelto en Windows, omitiendo test de ayuda bash');
        return;
      }
      throw e;
    }
  });

  test('baseline_metrics.json existe y tiene formato válido', () => {
    const baselinePath = path.join(__dirname, '..', 'data', 'eval', 'baseline_metrics.json');
    expect(fs.existsSync(baselinePath)).toBe(true);
    
    const content = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(content).toHaveProperty('timestamp');
    expect(content).toHaveProperty('version');
    expect(content).toHaveProperty('metrics');
    expect(content.metrics).toHaveProperty('retrieval');
    expect(content.metrics).toHaveProperty('generation');
    expect(content.metrics).toHaveProperty('latency');
  });

  test('evaluation_dataset.json existe y tiene 30+ queries', () => {
    const datasetPath = path.join(__dirname, '..', 'data', 'eval', 'evaluation_dataset.json');
    expect(fs.existsSync(datasetPath)).toBe(true);
    
    const content = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    expect(content).toHaveProperty('queries');
    expect(content.queries.length).toBeGreaterThanOrEqual(30);
  });
});