// Sonda del enlace de compartir.
//
// Abre una URL en Chrome headless (CDP, sin dependencias), y reporta lo que
// importa para juzgar un enlace compartido: qué pantalla termina mostrando, qué
// etiquetas Open Graph lleva (lo que ve WhatsApp/Instagram) y qué errores salen
// en consola. Guarda además una captura.
//
//   node tools/sonda_compartir.js <url> [captura.png]
//
// Devuelve código 1 si la página termina en blanco (sin texto ni canvas útil),
// para que sirva de compuerta en el pipeline.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME_CANDIDATOS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const URL_OBJETIVO = process.argv[2];
const CAPTURA = process.argv[3] || null;
const PUERTO = Number(process.env.SONDA_PUERTO || 9231);
const ESPERA_MS = Number(process.env.SONDA_ESPERA_MS || 14000);

if (!URL_OBJETIVO) {
  console.error('uso: node tools/sonda_compartir.js <url> [captura.png]');
  process.exit(2);
}

const chrome = CHROME_CANDIDATOS.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('no se encontró Chrome/Edge en las rutas conocidas');
  process.exit(2);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = path.join(os.tmpdir(), `sonda-compartir-${Date.now()}`);

async function json(ruta) {
  const r = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`);
  return r.json();
}

async function main() {
  const proceso = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${PUERTO}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Para validar un build local: el backend solo acepta los orígenes
    // publicados, así que sin esto las llamadas fallan por CORS y la pantalla
    // muestra error de red en vez de datos.
    ...(process.env.SONDA_SIN_CORS === '1' ? ['--disable-web-security'] : []),
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 60; i++) {
    try { version = await json('/json/version'); break; } catch { await dormir(500); }
  }
  if (!version) throw new Error('el navegador no arrancó');

  const pestañas = await json('/json/list');
  const pestaña = pestañas.find((t) => t.type === 'page');
  const ws = new WebSocket(pestaña.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = mal; });

  let id = 0;
  const pendientes = new Map();
  const consola = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pendientes.has(msg.id)) {
      pendientes.get(msg.id)(msg);
      pendientes.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const texto = (msg.params.args || []).map((a) => a.value || a.description).join(' ').slice(0, 200);
      consola.push(`${msg.params.type}: ${texto}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consola.push('exception: ' + (msg.params.exceptionDetails?.text || '').slice(0, 200));
    }
  };
  const enviar = (method, params = {}) => new Promise((ok) => {
    const mid = ++id;
    pendientes.set(mid, ok);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluar = async (expr) => (await enviar('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  })).result?.result?.value;

  await enviar('Page.enable');
  await enviar('Runtime.enable');
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    screenWidth: 390, screenHeight: 844,
  });
  // Traza de la URL: sirve para saber si el path del enlace sobrevive hasta que
  // la app lo lee (el router lo reescribe como `/#/home`).
  await enviar('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__urls = [];
      const marca = (t) => window.__urls.push(t + ' ' + location.pathname + location.hash);
      marca('inicio');
      [10, 100, 500, 1500, 4000].forEach((ms) => setTimeout(() => marca(ms + 'ms'), ms));`,
  });
  await enviar('Page.navigate', { url: URL_OBJETIVO });
  await dormir(ESPERA_MS);

  const datos = await evaluar(`(() => {
    const meta = (p) => document.querySelector('meta[property="' + p + '"]')?.content ?? null;
    const lienzos = [...document.querySelectorAll('canvas')];
    // CanvasKit arranca el canvas dentro de flt-scene-host; el lienzo puede
    // seguir en 0x0 durante el primer segundo. Se considera pintado si hay
    // lienzo, escena o semántica de Flutter montada.
    const hayPintura = lienzos.length > 0 ||
      !!document.querySelector('flt-scene-host, flt-glass-pane, flutter-view');
    return {
      url: location.href,
      title: document.title,
      og: {
        title: meta('og:title'),
        description: meta('og:description'),
        image: meta('og:image'),
        url: meta('og:url'),
      },
      texto: (document.body.innerText || '').trim().slice(0, 200),
      lienzos: lienzos.length,
      hayPintura,
      iframes: document.querySelectorAll('iframe').length,
      trazaUrl: window.__urls || [],
    };
  })()`);

  // En blanco = la app no pintó ni dejó texto: el enlace no lleva a nada.
  const enBlanco = !datos || (!datos.hayPintura && (datos.texto || '').length === 0);
  console.log(JSON.stringify({ ...datos, enBlanco, consola: consola.slice(-40) }, null, 2));

  if (CAPTURA) {
    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(CAPTURA, Buffer.from(shot.result.data, 'base64'));
    console.log('CAPTURA ' + CAPTURA);
  }

  ws.close();
  proceso.kill('SIGKILL');
  await dormir(400);
  try {
    fs.rmSync(perfil, { recursive: true, force: true });
  } catch {
    // Chrome en Windows puede seguir reteniendo el perfil; no es un fallo de la sonda.
  }
  process.exit(enBlanco ? 1 : 0);
}

main().catch((e) => {
  console.error('FALLO', e);
  process.exit(2);
});
