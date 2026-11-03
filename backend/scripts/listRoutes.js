const fs = require('fs');
const path = require('path');

const app = require('../index');

function cleanRegexpSource(source) {
  if (!source || source === '^\\/' || source === '^\\/\\/?') return '';

  let cleaned = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)/g, '')
    .replace(/\$\/?$/g, '')
    .replace(/\\\//g, '/')
    .replace(/\?\(\?=\/\|\$\)/g, '')
    .replace(/\?$/g, '');

  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  return cleaned;
}

function extractRoutes(app) {
  const routes = [];

  function print(stack, prefix = '') {
    if (!stack) return;
    
    stack.forEach(layer => {
      if (layer.route) {
        let routePath = layer.route.path;
        if (routePath === '/') routePath = '';
        const fullPath = (prefix + routePath) || '/';
        const methods = Object.keys(layer.route.methods)
          .filter(m => layer.route.methods[m])
          .map(m => m.toUpperCase());

        methods.forEach(method => {
          routes.push({ method, path: fullPath });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        let routePrefix = '';
        if (layer.regexp && layer.regexp.source) {
          routePrefix = cleanRegexpSource(layer.regexp.source);
        }
        print(layer.handle.stack, prefix + routePrefix);
      }
    });
  }

  if (app._router && app._router.stack) {
    print(app._router.stack);
  }

  const uniqueMap = new Map();
  routes.forEach(r => {
    // Normalizar barras dobles
    const normPath = r.path.replace(/\/+/g, '/');
    const key = `${r.method} ${normPath}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { method: r.method, path: normPath });
    }
  });

  return Array.from(uniqueMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function run() {
  console.log('🔍 Inspeccionando stack de rutas de Express...');
  const routesList = extractRoutes(app);
  console.log(`✅ Se encontraron ${routesList.length} rutas configuradas.`);

  const docsDir = path.resolve(__dirname, '../../docs/audit');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'routes-2026-09-24.json');
  fs.writeFileSync(outputPath, JSON.stringify(routesList, null, 2), 'utf-8');
  console.log(`📄 Archivo de inventario de rutas generado exitosamente en: ${outputPath}`);
  process.exit(0);
}

run();
