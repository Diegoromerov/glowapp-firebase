#!/usr/bin/env node
/**
 * Guard de la bandeja de PQRSF del panel (`/admin/pqrsf`).
 *
 * QUÉ PROTEGE, y por qué cada cosa:
 *   1. Que las opciones de estado/prioridad NO se escriban en la pantalla. En este repo el
 *      botón "Atender" de SOS no hacía nada porque el código escribía un valor que el CHECK
 *      de la tabla no admitía: una lista copiada se desincroniza en cuanto una migración
 *      añade un valor.
 *   2. Que el conteo de la bandeja y el hilo del detalle no compartan clave: `mensajes` es
 *      el ARRAY en el detalle, así que la bandeja usa otro nombre.
 *   3. Que las mutaciones lleven el encabezado CSRF: el BFF responde 403 a un POST/PATCH sin
 *      `X-Requested-With`, y el síntoma sería "el botón no hace nada" otra vez.
 *   4. Que el texto del usuario no pase por `sanitizeText()`: esa función termina en
 *      `escapeHtml()` y JSX ya escapa, así que daría doble escape (se leería "&amp;").
 *   5. Que los campos que la pantalla lee existan de verdad en la respuesta del controlador.
 *
 * Estático: lee los fuentes. Se ejecuta con `node --test tests/pqrsf-panel.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const panel = join(import.meta.dirname, '..');
const repo = join(panel, '..');
const PAGINA = join(panel, 'src', 'app', '(dashboard)', 'admin', 'pqrsf', 'page.tsx');
const SIDEBAR = join(panel, 'src', 'components', 'dashboard', 'Sidebar.tsx');
const CTRL = join(repo, 'backend', 'src', 'controllers', 'adminTicketController.js');
const RUTAS = join(repo, 'backend', 'src', 'routes', 'adminTicketRoutes.js');

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/**
 * Fuente sin las líneas de comentario. Un guardián que mira el texto crudo se conforma con
 * un comentario: ya pasó con una línea comentada que seguía dando verde.
 */
const sinComentarios = (fuente) =>
  fuente
    .split('\n')
    .filter((linea) => {
      const l = linea.trim();
      return !(l.startsWith('//') || l.startsWith('*') || l.startsWith('/*'));
    })
    .join('\n');

/** Cuerpo de un handler `exports.x = async ...`, para no confundirlo con otro parecido. */
function cuerpoDe(fuente, nombre) {
  const marca = `exports.${nombre} = async`;
  const i = fuente.indexOf(marca);
  if (i === -1) return null;
  const j = fuente.indexOf('\nexports.', i + marca.length);
  return fuente.slice(i, j === -1 ? fuente.length : j);
}

/** Cuerpo de `function nombre(...) { ... }`, por conteo de llaves. */
function funcionDe(fuente, nombre) {
  const i = fuente.indexOf(`function ${nombre}(`);
  if (i === -1) return null;
  let nivel = 0;
  for (let k = fuente.indexOf('{', i); k < fuente.length; k += 1) {
    if (fuente[k] === '{') nivel += 1;
    else if (fuente[k] === '}') {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(i, k + 1);
    }
  }
  return fuente.slice(i);
}

/** Sin los comentarios de línea del SQL: un `--` explicativo no debe dar verde. */
const sqlSinComentarios = (fuente) =>
  fuente
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

const PAGINA_CRUDA = read(PAGINA);
const PAGINA_CODIGO = sinComentarios(PAGINA_CRUDA);
const CTRL_CRUDO = read(CTRL);

test('la pantalla existe y es un componente de cliente', () => {
  assert.ok(existsSync(PAGINA), 'falta la pantalla /admin/pqrsf');
  assert.match(PAGINA_CRUDA, /^'use client';/m, 'debe ser componente de cliente');
});

test('el enlace está en el menú del panel', () => {
  const sidebar = read(SIDEBAR);
  assert.match(sidebar, /href: '\/admin\/pqrsf'/, 'el menú no ofrece la bandeja de PQRSF');
});

test('los filtros y las opciones salen del esquema que sirve el backend', () => {
  // Las listas que se pintan deben venir de `esquema.valores`, no de un literal.
  for (const campo of ['estado', 'prioridad', 'tipo']) {
    assert.match(
      PAGINA_CODIGO,
      new RegExp(`valores\\.${campo}\\.map`),
      `las opciones de ${campo} deben derivarse de valores.${campo}`
    );
  }
  assert.match(
    PAGINA_CODIGO,
    /fetch\('\/api\/admin\/tickets\/esquema'/,
    'la pantalla debe pedir el esquema al backend'
  );
  // Y no debe llevar ninguna lista literal de valores admisibles.
  assert.doesNotMatch(
    PAGINA_CODIGO,
    /\['ABIERTO'|\[\s*'EMERGENCIA'|\[\s*'PETICION'|\[\s*'CERRADO'/,
    'la pantalla no debe llevar una lista literal de estados/prioridades/tipos'
  );
});

test('al cambiar de estado se envía lo elegido, no un valor escrito en la pantalla', () => {
  // Un cuerpo con el valor entrecomillado sería exactamente el defecto del botón de SOS:
  // la pantalla fijando un valor que el esquema puede no admitir.
  assert.doesNotMatch(
    PAGINA_CODIGO,
    /estado:\s*'[A-Z_]+'/,
    'el estado enviado debe venir de la lista del servidor, no de un literal'
  );
  assert.doesNotMatch(
    PAGINA_CODIGO,
    /prioridad:\s*'[A-Z_]+'/,
    'la prioridad enviada debe venir de la lista del servidor, no de un literal'
  );
  assert.match(
    PAGINA_CODIGO,
    /const cambiar = async \(cambio: \{ estado\?: string; prioridad\?: string \}\)/,
    'debe haber un único punto de escritura que reciba el valor elegido'
  );
});

test('una etiqueta sin traducción se muestra tal cual (no se oculta el valor)', () => {
  assert.match(
    PAGINA_CODIGO,
    /ETIQUETAS\[valor\]\s*\?\?\s*valor/,
    'las etiquetas son presentación: un valor sin traducción debe mostrarse crudo, ' +
      'no sustituirse por vacío'
  );
});

test('la bandeja usa un conteo y el detalle el hilo: la misma clave no vale para los dos', () => {
  assert.match(PAGINA_CRUDA, /mensajes_total: number/, 'la fila debe declarar mensajes_total');
  assert.match(
    PAGINA_CRUDA,
    /Omit<Fila, 'mensajes_total'>/,
    'el detalle debe omitir el conteo para no heredar el tipo equivocado'
  );
  assert.match(
    PAGINA_CODIGO,
    /f\.mensajes_total/,
    'la bandeja debe leer el conteo por su nombre'
  );
  assert.match(
    PAGINA_CODIGO,
    /detalle\.mensajes\.length/,
    'el detalle debe leer la colección del hilo'
  );
  // Y en el backend, la bandeja no puede devolver `mensajes` como número. Se mira sólo el
  // cuerpo del handler de la bandeja: el SQL parecido de otro handler no cuenta.
  const bandeja = sqlSinComentarios(cuerpoDe(CTRL_CRUDO, 'listarTickets') || '');
  assert.ok(bandeja, 'no encontré el handler de la bandeja');
  assert.match(bandeja, /AS mensajes_total\b/, 'la bandeja del backend debe aliasar el conteo');
  assert.doesNotMatch(
    bandeja,
    /FROM ticket_mensajes m WHERE m\.ticket_id = t\.id\) AS mensajes\b(?!_total)/,
    'un `AS mensajes` en la bandeja choca con el array del detalle'
  );
});

test('toda mutación lleva el encabezado que el BFF exige', () => {
  assert.match(PAGINA_CODIGO, /'X-Requested-With': 'XMLHttpRequest'/, 'falta el encabezado CSRF');
  // Cada PATCH/POST del archivo debe declarar las cabeceras del BFF.
  const mutaciones = PAGINA_CODIGO.split(/method:\s*'(PATCH|POST)'/).length - 1;
  assert.ok(mutaciones >= 2, `esperaba al menos 2 mutaciones, hay ${mutaciones}`);
  assert.match(
    PAGINA_CODIGO,
    /method: 'PATCH',\s*\n\s*headers: getBffHeaders\(\),/,
    'el PATCH debe llevar getBffHeaders()'
  );
  assert.match(
    PAGINA_CODIGO,
    /method: 'POST',\s*\n\s*headers: getBffHeaders\(\),/,
    'el POST debe llevar getBffHeaders()'
  );
});

test('el texto escrito por el usuario no se sanitiza dos veces', () => {
  // sanitizeText termina en escapeHtml y JSX ya escapa: aplicarla aquí mostraría "&amp;"
  // y se comería los "<" del relato del usuario.
  assert.doesNotMatch(
    PAGINA_CODIGO,
    /sanitizeText\(/,
    'no usar sanitizeText sobre texto que se interpola en JSX (doble escape)'
  );
});

test('los campos que la pantalla lee existen en la respuesta del controlador', () => {
  // El contrato de rutas ya comprueba (método, camino). Esto comprueba los CAMPOS: un
  // renombrado en el backend dejaría la pantalla mostrando vacíos sin ningún error.
  const camposDeLaPantalla = [
    'mensajes_total',
    'respuestas_operador',
    'usuario_email',
    'usuario_nombre',
    'primera_respuesta_en',
    'plazo_minutos',
    'respondido_a_tiempo',
    'minutos_primera_respuesta',
    'dias_habiles_restantes',
    'festivos_incluidos',
    'por_prioridad',
    'sin_respuesta',
    'plazos_minutos',
  ];
  // Se compara contra el CÓDIGO sin comentarios en ambos lados: el nombre de un campo
  // aparece en las explicaciones, y una aserción que mira el texto crudo se conforma con
  // que el nombre siga escrito en la prosa aunque ya no se devuelva.
  //
  // Y se compara contra el handler que PRODUCE el campo, no contra el archivo entero: un
  // renombrado en `conTiempos` seguía dando verde porque el mismo nombre existe también en
  // el bloque ARCO de las métricas, donde la pantalla no lo lee.
  const ctrlCodigo = sinComentarios(CTRL_CRUDO);
  const regiones = {
    fila: `${funcionDe(ctrlCodigo, 'conTiempos') || ''}\n${cuerpoDe(ctrlCodigo, 'listarTickets') || ''}`,
    metricas: cuerpoDe(ctrlCodigo, 'metricasTickets') || '',
    esquema: cuerpoDe(ctrlCodigo, 'esquemaTickets') || '',
  };
  const porRegion = {
    fila: [
      'mensajes_total',
      'respuestas_operador',
      'usuario_email',
      'usuario_nombre',
      'primera_respuesta_en',
      'plazo_minutos',
      'respondido_a_tiempo',
      'minutos_primera_respuesta',
      'dias_habiles_restantes',
      'festivos_incluidos',
    ],
    metricas: ['por_prioridad', 'por_estado', 'sin_respuesta', 'abiertos', 'vencidos'],
    esquema: ['plazos_minutos'],
  };
  for (const [region, campos] of Object.entries(porRegion)) {
    assert.ok(regiones[region], `no pude aislar la región ${region} del controlador`);
    for (const campo of campos) {
      assert.ok(
        regiones[region].includes(campo),
        `el backend dejó de producir \`${campo}\` en ${region}`
      );
      assert.ok(PAGINA_CODIGO.includes(campo), `la pantalla dejó de leer \`${campo}\``);
    }
  }
  // La lista de arriba no puede quedarse corta en silencio.
  for (const campo of camposDeLaPantalla) {
    assert.ok(PAGINA_CODIGO.includes(campo), `la pantalla dejó de leer \`${campo}\``);
  }
});

test('la interfaz dice la verdad sobre el correo que todavía no sale', () => {
  assert.match(
    PAGINA_CODIGO,
    /correo_enviado === true/,
    'la pantalla debe decidir el mensaje según lo que el backend declaró'
  );
  assert.match(
    PAGINA_CRUDA,
    /todavía no se envía/i,
    'mientras el correo no exista, la interfaz debe decirlo'
  );
});

test('el plazo legal se declara sin festivos', () => {
  assert.match(
    PAGINA_CODIGO,
    /festivos_incluidos === false/,
    'si el cálculo no descuenta festivos, la pantalla debe advertirlo'
  );
});

test('las colecciones se normalizan antes de usarse', () => {
  assert.match(PAGINA_CODIGO, /const asArray = <T,>/, 'debe existir el normalizador');
  assert.match(PAGINA_CODIGO, /Array\.isArray\(valor\)/, 'el normalizador debe usar Array.isArray');
  const usos = PAGINA_CODIGO.match(/asArray</g) || [];
  assert.ok(usos.length >= 2, `esperaba normalizar al menos 2 colecciones, hay ${usos.length}`);
});

test('las rutas que llama la pantalla son las que el backend monta', () => {
  const rutas = sinComentarios(read(RUTAS));
  assert.match(rutas, /router\.get\('\/tickets'/, 'falta GET /tickets');
  assert.match(rutas, /router\.get\('\/tickets\/metricas'/, 'falta GET /tickets/metricas');
  assert.match(rutas, /router\.get\('\/tickets\/esquema'/, 'falta GET /tickets/esquema');
  assert.match(rutas, /router\.patch\(\s*'\/tickets\/:id'/, 'falta PATCH /tickets/:id');
  assert.match(rutas, /'\/tickets\/:id\/respuesta'/, 'falta POST /tickets/:id/respuesta');
  for (const llamada of [
    '`/api/admin/tickets?${',
    "'/api/admin/tickets/metricas'",
    "'/api/admin/tickets/esquema'",
    '/api/admin/tickets/${id}`',
    '/api/admin/tickets/${abierto}/respuesta`',
  ]) {
    assert.ok(PAGINA_CRUDA.includes(llamada), `la pantalla no llama a ${llamada}`);
  }
});
