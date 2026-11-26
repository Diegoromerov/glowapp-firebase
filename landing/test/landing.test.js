'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const landing = path.resolve(__dirname, '..');
const publicDir = path.join(landing, 'public');
const config = JSON.parse(fs.readFileSync(path.join(landing, 'landing.config.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function startServer({ configStatus = 200, siteKey = 'test-site-key' } = {}) {
  const appPath = process.env.TEST_APP_JS || path.join(publicDir, 'app.js');
  const server = http.createServer((req, res) => {
    if (req.url === '/landing.config.json') {
      if (configStatus !== 200) { res.writeHead(configStatus); return res.end('not found'); }
      const testConfig = structuredClone(config);
      testConfig.domainEnvMap = { localhost: 'development', '127.0.0.1': 'development' };
      testConfig.turnstileSiteKey.development = siteKey;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(testConfig));
    }
    const pathname = req.url === '/' ? '/index.html' : req.url;
    if (pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(appPath).pipe(res);
    }
    const file = path.join(publicDir, pathname.replace(/^\//, ''));
    if (!file.startsWith(publicDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function completeRequiredFields(page) {
  await page.locator('[name=name]').fill('Prueba');
  await page.locator('[name=contact]').fill('prueba@example.com');
  await page.locator('[name=city]').fill('Bogotá');
  await page.locator('[name=neighborhood]').fill('Centro').catch(() => {});
  await page.locator('[name=businessName]').fill('Salón de prueba').catch(() => {});
  await page.locator('[name=consent]').check();
}

async function assertAllButtonsOpen(page, label = 'flow') {
  for (const [id, role] of [['cliente', 'client'], ['profesional', 'professional'], ['salon', 'salon']]) {
    console.log(`[test] ${label}: click ${id}`);
    await page.locator(`[data-button="${id}"]`).click();
    assert.equal(await page.locator('#lead-dialog').evaluate(dialog => dialog.open), true, `${id} abre el diálogo`);
    assert.equal(await page.locator('[name=role]').inputValue(), role, `${id} asigna role=${role}`);
    assert.equal(await page.locator('[name=businessName]').evaluate(input => input.required), role === 'salon');
    assert.equal(await page.locator('[name=neighborhood]').evaluate(input => input.required), role !== 'salon');
    await page.locator('.dialog-close').click();
  }
}

async function submitAndReadStatus(page) {
  await page.locator('[data-button="cliente"]').click();
  await page.evaluate(() => {
    const form = document.querySelector('#lead-form');
    for (const [name, value] of [['name', 'Prueba'], ['contact', 'prueba@example.com'], ['city', 'Bogotá'], ['neighborhood', 'Centro']]) form.elements.namedItem(name).value = value;
    form.elements.namedItem('consent').checked = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return page.locator('.form-status').textContent();
}

test('los botones abren el formulario, aunque fallen Turnstile/config o falte la key; el envío explica cada fallo', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const normal = await startServer();
    try {
      const page = await browser.newPage();
      await page.route('https://challenges.cloudflare.com/**', route => route.abort('blockedbyclient'));
      const warnings = [];
      page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });
      await page.goto(normal.url);
      await page.waitForFunction(() => document.querySelector('#privacy-link').href.includes('privacy-policy.html'));
      await assertAllButtonsOpen(page);
      assert.equal(await submitAndReadStatus(page), 'No pudimos cargar la verificación de seguridad. Recarga la página o desactiva el bloqueador.');
      assert.ok(warnings.some(message => message.includes('Turnstile no cargó')));
    } finally { await normal.server.close(); }

    const missingConfig = await startServer({ configStatus: 404 });
    try {
      const page = await browser.newPage();
      const warnings = [];
      page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });
      await page.goto(missingConfig.url);
      await page.waitForTimeout(100);
      for (const [id, role] of [['cliente', 'client'], ['profesional', 'professional'], ['salon', 'salon']]) {
        await page.locator(`[data-button="${id}"]`).click();
        assert.equal(await page.locator('#lead-dialog').evaluate(dialog => dialog.open), true, `${id} abre sin config`);
        assert.equal(await page.locator('[name=role]').inputValue(), role);
        await page.locator('.dialog-close').click();
      }
      assert.equal(await submitAndReadStatus(page), 'No pudimos cargar la configuración. Recarga la página.');
      assert.ok(warnings.some(message => message.includes('Config no cargó')));
    } finally { await missingConfig.server.close(); }

    const noKey = await startServer({ siteKey: '' });
    try {
      const page = await browser.newPage();
      await page.goto(noKey.url);
      await page.waitForFunction(() => document.querySelector('#privacy-link').href.includes('privacy-policy.html'));
      await assertAllButtonsOpen(page);
      assert.equal(await submitAndReadStatus(page), 'El formulario aún no está habilitado.');
    } finally { await noKey.server.close(); }
  } finally { await browser.close(); }
});
