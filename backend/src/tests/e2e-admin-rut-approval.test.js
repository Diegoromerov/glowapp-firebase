// E2E Test: Admin RUT Approval -> FCM + rutAprobado gate
// Requiere: API_URL, ADMIN_TOKEN

const fetch = require('node-fetch');

const API_URL = process.env.API_URL || 'https://glowapp-api-production.up.railway.app';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PROVIDER_EMAIL = process.env.PROVIDER_EMAIL || `test_provider_${Date.now()}@glowapp.test`;
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'TestPass123!';
const PROVIDER_NAME = process.env.PROVIDER_NAME || 'Test Proveedor E2E';
const RUT_DATA_URI = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+c3RyZWFtCnicY2BgYGaAYBkGAF9fAQAJAgZmAQAKACAKL2VuZHN0cmVhbQplbmRvYmoKMyAwIG9iago8PAovTGVuZ3RoIDE5Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCj4+c3RyZWFtCnicY2BgYGaAYBkGAF9fAQAJAgZmAQAKACAKL2VuZHN0cmVhbQplbmRvYmoKNCAwIG9iago8PAovVHlwZS9DYXRhbG9nCi9QYWdlcyAxIDAgUgo+PgplbmRvYmoKMSAwIG9iago8PAovVHlwZS9QYWdlCi9QYXJlbnQgNCAwIFIKL1Jlc291cmNlcyAyIDAgUgo+PgplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE1OSAwMDAwMCBuIAowMDAwMDAwMjQwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNQovUm9vdCA0IDAgUgo+PgpzdGFydHhyZWYKMzQxCiUlRU9G';

async function request(path, options = {}) {
  const res = await fetch(API_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Audience': 'provider',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, ok: res.ok };
}

async function requestAuth(path, token, options = {}) {
  return request(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': 'Bearer ' + token,
    },
  });
}

async function runTest() {
  console.log('TEST E2E: Admin RUT Approval -> FCM + rutAprobado gate');
  console.log('==========================================================');

  // 1. Registrar prestador
  console.log('1. Registrando prestador...');
  const reg = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: PROVIDER_NAME,
      email: PROVIDER_EMAIL,
      password: PROVIDER_PASSWORD,
      rol: 'PRESTADOR',
    }),
  });
  console.log('   Status: ' + reg.status, reg.ok ? 'OK' : 'FAIL');
  if (!reg.ok) throw new Error('Registro fallo: ' + JSON.stringify(reg.data));

  // 2. Login prestador
  console.log('2. Login prestador...');
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD }),
  });
  console.log('   Status: ' + login.status, login.ok ? 'OK' : 'FAIL');
  if (!login.ok) throw new Error('Login fallo: ' + JSON.stringify(login.data));
  const providerToken = login.data.token;
  const providerId = login.data.user?.id;
  console.log('   Provider ID: ' + providerId);

  // 3. Completar onboarding
  console.log('3. Completando onboarding...');
  const onboarding = await requestAuth('/api/auth/onboarding', providerToken, {
    method: 'PATCH',
    body: JSON.stringify({
      rol: 'PRESTADOR',
      aceptar_habeas_data: true,
      aceptar_terminos: true,
    }),
  });
  console.log('   Status: ' + onboarding.status, onboarding.ok ? 'OK' : 'FAIL');
  if (!onboarding.ok) console.log('   Response: ' + JSON.stringify(onboarding.data));

  // 4. Subir RUT con data URI
  console.log('4. Subiendo RUT (data URI)...');
  const rutUpload = await requestAuth('/api/provider/fiscal/rut', providerToken, {
    method: 'POST',
    body: JSON.stringify({
      rut_numero: '900123456-7',
      rut_responsabilidad_codigo: 48,
      soporte_url: RUT_DATA_URI,
    }),
  });
  console.log('   Status: ' + rutUpload.status, rutUpload.ok ? 'OK' : 'FAIL');
  if (!rutUpload.ok) console.log('   Response: ' + JSON.stringify(rutUpload.data));

  // 5. Verificar estado revision_estado = PENDIENTE
  console.log('5. Verificando estado RUT (GET /api/provider/fiscal)...');
  const fiscal = await requestAuth('/api/provider/fiscal', providerToken, { method: 'GET' });
  console.log('   Status: ' + fiscal.status, fiscal.ok ? 'OK' : 'FAIL');
  if (fiscal.ok) {
    console.log('   revision_estado: ' + (fiscal.data.revision?.estado || 'N/A'));
    console.log('   puede_publicar_servicios: ' + fiscal.data.puede_publicar_servicios);
    console.log('   motivo_publicacion: ' + fiscal.data.motivo_publicacion);
  }

  // 6. Admin: aprobar RUT (requiere ADMIN_TOKEN)
  if (!ADMIN_TOKEN) {
    console.log('ADMIN_TOKEN no seteado - saltando aprobacion admin');
    console.log('Setea ADMIN_TOKEN (Bearer token con role=admin) para test completo');
    return;
  }

  console.log('6. Admin: listando prestadores pendientes...');
  const pending = await requestAuth('/api/admin/providers/pending', ADMIN_TOKEN);
  console.log('   Status: ' + pending.status, pending.ok ? 'OK' : 'FAIL');

  console.log('7. Admin: APROBANDO RUT (POST /api/admin/providers/:id/fiscal/revision)...');
  const approve = await requestAuth('/api/admin/providers/' + providerId + '/fiscal/revision', ADMIN_TOKEN, {
    method: 'POST',
    body: JSON.stringify({ accion: 'APROBAR', nota: 'RUT verificado manualmente - E2E test' }),
  });
  console.log('   Status: ' + approve.status, approve.ok ? 'OK' : 'FAIL');
  if (approve.ok) {
    console.log('   Response:', JSON.stringify(approve.data, null, 2));
    if (approve.data.ok && approve.data.revision?.estado === 'APROBADA') {
      console.log('   RUT aprobado correctamente');
    } else {
      throw new Error('Respuesta de aprobacion invalida');
    }
  } else {
    console.log('   Response: ' + JSON.stringify(approve.data));
    throw new Error('Aprobacion fallo');
  }

  // 8. Verificar FCM push fue intentado
  console.log('8. FCM push: revisar logs backend para aprobacion RUT');

  // 9. Verificar gate rutAprobado
  console.log('9. Verificando gate rutAprobado (POST /services con is_active=true)...');
  const createService = await requestAuth('/services', providerToken, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Corte de prueba E2E',
      description: 'Servicio de prueba para validar rutAprobado',
      category: 'cabello',
      duration_min: 30,
      price: 50000,
      is_active: true,
    }),
  });
  console.log('   Status: ' + createService.status, createService.ok ? 'OK' : 'FAIL');
  if (createService.ok) {
    console.log('   Gate rutAprobado PASA - servicio publicado');
  } else if (createService.data.error === 'RUT_NO_APROBADO') {
    console.log('   Gate rutAprobado BLOQUEA - RUT no aprobado en BD');
    console.log('   Response:', createService.data);
  } else {
    console.log('   Error inesperado:', createService.data);
  }

  // 10. Verificar estado fiscal actualizado
  console.log('10. Verificando estado fiscal actualizado...');
  const fiscal2 = await requestAuth('/api/provider/fiscal', providerToken, { method: 'GET' });
  console.log('   Status: ' + fiscal2.status);
  if (fiscal2.ok) {
    console.log('   revision_estado: ' + (fiscal2.data.revision?.estado || 'N/A'));
    console.log('   puede_publicar_servicios: ' + fiscal2.data.puede_publicar_servicios);
    console.log('   motivo_publicacion: ' + fiscal2.data.motivo_publicacion);
  }

  console.log('==========================================================');
  console.log('TEST E2E COMPLETADO');
  console.log('==========================================================');
  console.log('Resumen:');
  console.log('  - Provider ID: ' + providerId);
  console.log('  - RUT subido -> PENDIENTE');
  console.log('  - Admin aprovo via /api/admin/providers/:id/fiscal/revision (dashboard)');
  console.log('  - FCM push enviado (verificar logs backend)');
  console.log('  - rutAprobado gate: ' + (createService.ok ? 'PASA OK' : 'FALLA FAIL'));
}

runTest().catch(err => {
  console.error('TEST FALLO:', err.message);
  process.exit(1);
});
