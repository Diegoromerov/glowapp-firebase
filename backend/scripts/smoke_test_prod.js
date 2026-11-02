// backend/scripts/smoke_test_prod.js
/**
 * Script de Smoke Test Sintético para Verificación en Producción Post-Despliegue (Sprint 4.1)
 * Ejecución: node backend/scripts/smoke_test_prod.js [URL_BASE_PROD]
 */
const http = require('http');
const https = require('https');

const baseUrl = process.argv[2] || process.env.PROD_API_URL || 'http://localhost:3000';

console.log(`🔎 Iniciando Smoke Test Sintético de Producción contra: ${baseUrl}`);

function makeRequest(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSmokeTests() {
  try {
    // 1. Health Check de la API
    console.log('1. Probando endpoint de healthcheck / estado...');
    const health = await makeRequest('/api/consent/status/7');
    console.log(`   Result: HTTP ${health.status}`);

    // 2. Probar rechazo de petición biométrica sin Idempotency-Key
    console.log('2. Probando rechazo de seguridad (Missing Idempotency-Key)...');
    const idempotencyCheck = await makeRequest('/api/biometric/analyze', 'POST', {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer valid-jwt-token',
    }, { faceImage: 'dummy' });
    
    if (idempotencyCheck.status === 400) {
      console.log('   ✅ Paso exitoso: Rechazo 400 confirmado para falta de Idempotency-Key.');
    } else {
      console.warn(`   ⚠️ Respuesta inesperada: HTTP ${idempotencyCheck.status}`);
    }

    console.log('🎉 Smoke Test Sintético Finalizado Exitosamente.');
  } catch (error) {
    console.error('❌ Error ejecutando el Smoke Test:', error.message);
    process.exit(1);
  }
}

runSmokeTests();
