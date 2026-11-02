'use strict';
/*
 * pqrsfF2.integracion.js — Prueba de integracion REAL de los endpoints de PQRSF (Fase 2).
 *
 * No revisa el codigo: lo EJECUTA. Llama a los cinco handlers del controlador con
 * peticiones simuladas contra un Postgres de verdad, y comprueba lo que quedo escrito en
 * la base (no solo lo que devolvio la respuesta).
 *
 * POR QUE CONTRA POSTGRES Y NO CON EL HARNESS EN MEMORIA
 *   El backend trae `src/config/pgMemory.js`, que sustituye la base por pg-mem cuando
 *   NODE_ENV=test o JEST_WORKER_ID. Ese harness declara el esquema PERMISIVO a proposito
 *   (sin FK y sin CHECK), asi que toda prueba de restricciones ahi es VACUA: un valor que
 *   el CHECK de produccion rechaza pasaria sin ruido. Justo la clase de defecto que
 *   produjo el boton "Atender" muerto. Por eso aqui se exige la base real con
 *   USE_PG_MEM=false, y el script aborta si el motor no es PostgreSQL.
 *
 * COMO CORRERLO  (ver README.md de esta carpeta)
 *   node backend/tests/integracion/pqrsfF2.integracion.js
 */
// SIN credenciales en el archivo a proposito: el repositorio tiene escaneres de
// credenciales en CI y una URL con usuario:clave se parece demasiado a un secreto real.
// El rol y su clave son de una base desechable creada a mano (ver README.md de esta
// carpeta), y se pasan por entorno.
const CLAVE_LOCAL = process.env.PQRSF_TEST_DB_PASSWORD;
const URL_PRUEBA =
  process.env.PQRSF_TEST_DATABASE_URL
  || (CLAVE_LOCAL
    ? `postgres://f2test:${encodeURIComponent(CLAVE_LOCAL)}@localhost:5432/f2test`
    : null);
if (!URL_PRUEBA) {
  console.error(
    'Falta PQRSF_TEST_DB_PASSWORD (o PQRSF_TEST_DATABASE_URL).\n' +
      'Ver backend/tests/integracion/README.md para preparar la base de prueba.'
  );
  process.exit(3);
}
process.env.DATABASE_URL = URL_PRUEBA;
// OJO: el backend trae un harness en memoria (pg-mem) que se activa con NODE_ENV=test o
// JEST_WORKER_ID, y su esquema es PERMISIVO (sin FK ni CHECK). Ahí toda prueba de
// restricciones es vacua, así que aquí se exige la base real con la bandera de casa.
process.env.USE_PG_MEM = 'false';

const ctrl = require('../../src/controllers/adminTicketController');
const { sequelize } = require('../../src/config/database');

const T1 = '11111111-1111-1111-1111-111111111111'; // EMERGENCIA, 3 h, sin responder
const T2 = '22222222-2222-2222-2222-222222222222'; // ALTA, 30 min, respondida a los 20 min
const T3 = '33333333-3333-3333-3333-333333333333'; // BAJA, 3 h, sin responder
const T4 = '44444444-4444-4444-4444-444444444444'; // ARCO, 1 h, sin responder
const T5 = '55555555-5555-5555-5555-555555555555'; // ALTA, 5 h, sin responder

let fallos = 0;
let casos = 0;

function resFalso() {
  return {
    statusCode: 200,
    cuerpo: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.cuerpo = b; return this; },
  };
}
const peticion = (extra = {}) => ({
  params: {}, query: {}, body: {}, user: { id: 2, role: 'admin' },
  ...extra,
});

async function caso(nombre, fn) {
  casos += 1;
  try {
    await fn();
    console.log(`  OK   ${nombre}`);
  } catch (err) {
    fallos += 1;
    console.log(`  FALLO ${nombre}`);
    console.log(`         ${err.message}`);
  }
}
function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
const fila = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

(async () => {
  const [donde] = await fila('SELECT version() AS v');
  if (!/PostgreSQL/.test(donde.v)) {
    console.error(`ABORTADO: no estoy en PostgreSQL sino en "${donde.v}" (esquema permisivo, prueba vacua)`);
    process.exit(2);
  }
  console.log(`══ PQRSF Fase 2 · el controlador real contra ${donde.v.split(',')[0]} ══\n`);

  // ── Bandeja ─────────────────────────────────────────────────────────────────
  await caso('bandeja sin filtros: 5 tickets, abiertos y el más antiguo primero', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion(), res);
    afirmar(res.statusCode === 200, `esperaba 200, fue ${res.statusCode}`);
    afirmar(res.cuerpo.total === 5, `total ${res.cuerpo.total}`);
    afirmar(res.cuerpo.data.length === 5, `data ${res.cuerpo.data.length}`);
    afirmar(res.cuerpo.page === 1 && res.cuerpo.limit === 20, 'forma de paginación');
    afirmar(res.cuerpo.data[0].asunto.startsWith('t5'), `el primero fue ${res.cuerpo.data[0].asunto}`);
    afirmar(res.cuerpo.data[0].usuario_email === 'ana@ejemplo.test', 'no trae el contacto del solicitante');
  });

  await caso('filtro por prioridad', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion({ query: { prioridad: 'EMERGENCIA' } }), res);
    afirmar(res.cuerpo.total === 1, `total ${res.cuerpo.total}`);
    afirmar(res.cuerpo.data[0].id === T1, 'no es la emergencia');
  });

  await caso('filtro sin_respuesta', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion({ query: { sin_respuesta: 'true' } }), res);
    afirmar(res.cuerpo.total === 4, `total ${res.cuerpo.total} (esperaba 4: todas menos la respondida)`);
  });

  await caso('filtro vencidos: el plazo sale del helper (EMERGENCIA 30min y ALTA 2h)', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion({ query: { vencidos: 'true' } }), res);
    const ids = res.cuerpo.data.map((t) => t.id).sort();
    afirmar(res.cuerpo.total === 2, `total ${res.cuerpo.total} (esperaba t1 EMERGENCIA 3h y t5 ALTA 5h)`);
    afirmar(ids[0] === T1 && ids[1] === T5, `ids ${ids}`);
  });

  await caso('la BAJA de 3 h NO está vencida (48 h) y la respetada tampoco', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion({ query: { vencidos: 'true' } }), res);
    const ids = res.cuerpo.data.map((t) => t.id);
    afirmar(!ids.includes(T3), 'marcó vencida una BAJA de 3 h');
    afirmar(!ids.includes(T2), 'marcó vencida una ya respondida');
  });

  await caso('filtro por tipo ARCO y su plazo legal en días hábiles', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion({ query: { tipo: 'ARCO_SUPRESION' } }), res);
    afirmar(res.cuerpo.total === 1, `total ${res.cuerpo.total}`);
    const t = res.cuerpo.data[0];
    afirmar(t.legal !== null, 'el ticket ARCO no trae bloque legal');
    afirmar(t.legal.plazo_dias_habiles === 15, 'el plazo legal debe ser 15 días hábiles');
    afirmar(t.legal.vencido === false, 'lo marcó vencido con 1 h de vida');
    afirmar(t.legal.dias_habiles_restantes > 0, `días restantes ${t.legal.dias_habiles_restantes}`);
    afirmar(t.legal.festivos_incluidos === false, 'debe declarar que no incluye festivos');
  });

  await caso('un ticket normal NO trae bloque legal', async () => {
    const res = resFalso();
    await ctrl.detalleTicket(peticion({ params: { id: T1 } }), res);
    afirmar(res.cuerpo.data.legal === null, 'un RECLAMO no tiene plazo legal ARCO');
  });

  // ── Métricas ────────────────────────────────────────────────────────────────
  await caso('métricas: totales, vencidos y tiempo medio de respuesta', async () => {
    const res = resFalso();
    await ctrl.metricasTickets(peticion(), res);
    afirmar(res.statusCode === 200, `status ${res.statusCode}`);
    const d = res.cuerpo.data;
    afirmar(d.total === 5, `total ${d.total}`);
    afirmar(d.abiertos === 5, `abiertos ${d.abiertos}`);
    afirmar(d.vencidos === 2, `vencidos ${d.vencidos}`);
    afirmar(d.sin_respuesta === 4, `sin_respuesta ${d.sin_respuesta}`);
    const alta = d.por_prioridad.find((p) => p.prioridad === 'ALTA');
    afirmar(alta.total === 2, `ALTA total ${alta.total}`);
    afirmar(alta.sin_respuesta === 1, `ALTA sin_respuesta ${alta.sin_respuesta}`);
    afirmar(alta.vencidos === 1, `ALTA vencidos ${alta.vencidos}`);
    afirmar(
      alta.minutos_medio_respuesta > 15 && alta.minutos_medio_respuesta < 25,
      `tiempo medio de respuesta ${alta.minutos_medio_respuesta} min (esperaba ~20)`
    );
    afirmar(d.arco.abiertas.length === 1, 'debe listar la solicitud ARCO abierta');
  });

  // ── Detalle ─────────────────────────────────────────────────────────────────
  await caso('la bandeja devuelve un CONTEO, no la clave del hilo', async () => {
    const res = resFalso();
    await ctrl.listarTickets(peticion(), res);
    afirmar(res.statusCode === 200, `status ${res.statusCode}`);
    const fila = res.cuerpo.data[0];
    afirmar(
      typeof fila.mensajes_total === 'number',
      `mensajes_total debería ser número, es ${typeof fila.mensajes_total}`
    );
    afirmar(
      !('mensajes' in fila),
      'la bandeja no debe traer `mensajes`: esa clave es el array del hilo en el detalle'
    );
  });

  await caso('esquema: los valores salen del CHECK real, incluido el que una lista perdería', async () => {
    const res = resFalso();
    await ctrl.esquemaTickets(peticion(), res);
    afirmar(res.statusCode === 200, `status ${res.statusCode}`);
    const v = res.cuerpo.data.valores;
    afirmar(Array.isArray(v.estado) && v.estado.includes('ABIERTO'), `estado: ${JSON.stringify(v.estado)}`);
    afirmar(
      Array.isArray(v.prioridad) && v.prioridad.includes('EMERGENCIA'),
      `prioridad: ${JSON.stringify(v.prioridad)}`
    );
    // La 045 añadió este valor a `tickets.tipo`; una lista escrita en el código no lo tendría.
    afirmar(
      Array.isArray(v.tipo) && v.tipo.includes('ARCO_SUPRESION'),
      `tipo sin ARCO_SUPRESION: ${JSON.stringify(v.tipo)}`
    );
    afirmar(
      v.categoria === null || Array.isArray(v.categoria),
      `categoria debe ser lista o null, nunca inventada: ${JSON.stringify(v.categoria)}`
    );
    afirmar(
      res.cuerpo.data.sla.plazos_minutos.EMERGENCIA === 30,
      `plazos: ${JSON.stringify(res.cuerpo.data.sla.plazos_minutos)}`
    );
    afirmar(res.cuerpo.data.legal.plazo_dias_habiles === 15, 'el plazo legal ARCO debe declararse');
  });

  await caso('detalle: hilo con autor y SLA respondido', async () => {
    const res = resFalso();
    await ctrl.detalleTicket(peticion({ params: { id: T2 } }), res);
    afirmar(res.statusCode === 200, `status ${res.statusCode}`);
    const d = res.cuerpo.data;
    afirmar(d.mensajes.length === 2, `mensajes ${d.mensajes.length}`);
    afirmar(d.mensajes[0].autor_tipo === 'USUARIO', 'el primero debe ser del usuario');
    afirmar(d.mensajes[1].autor_tipo === 'OPERADOR', 'el segundo debe ser del operador');
    afirmar(d.sla.estado === 'respondido', `sla ${d.sla.estado}`);
    afirmar(d.sla.respondido_a_tiempo === true, 'debió llegar a tiempo (20 min de 120)');
    afirmar(d.usuario_nombre === 'Ana Cliente', 'falta el nombre del solicitante');
  });

  await caso('detalle con id que no es UUID y con id inexistente', async () => {
    const a = resFalso();
    await ctrl.detalleTicket(peticion({ params: { id: 'no-es-uuid' } }), a);
    afirmar(a.statusCode === 400, `esperaba 400, fue ${a.statusCode}`);
    const b = resFalso();
    await ctrl.detalleTicket(peticion({ params: { id: '99999999-9999-9999-9999-999999999999' } }), b);
    afirmar(b.statusCode === 404, `esperaba 404, fue ${b.statusCode}`);
  });

  // ── Cambio de estado (lo que faltaba de F1) ─────────────────────────────────
  await caso('PATCH a RESUELTO escribe resuelto_en (el escritor que faltaba)', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: { estado: 'RESUELTO' } }), res);
    afirmar(res.statusCode === 200, `status ${res.statusCode} ${JSON.stringify(res.cuerpo)}`);
    const [t] = await fila('SELECT estado, resuelto_en, cerrado_en FROM tickets WHERE id = :id', { id: T1 });
    afirmar(t.estado === 'RESUELTO', `estado ${t.estado}`);
    afirmar(t.resuelto_en !== null, 'resuelto_en quedó vacío');
    afirmar(t.cerrado_en === null, 'cerrado_en no debía tocarse');
  });

  await caso('reabrir LIMPIA resuelto_en: no puede contar como resuelto estando abierto', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: { estado: 'EN_PROCESO' } }), res);
    const [t] = await fila('SELECT estado, resuelto_en, cerrado_en FROM tickets WHERE id = :id', { id: T1 });
    afirmar(t.estado === 'EN_PROCESO', `estado ${t.estado}`);
    afirmar(t.resuelto_en === null, 'un ticket reabierto sigue figurando como resuelto');
  });

  await caso('PATCH a CERRADO escribe cerrado_en', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: { estado: 'CERRADO' } }), res);
    const [t] = await fila('SELECT cerrado_en FROM tickets WHERE id = :id', { id: T1 });
    afirmar(t.cerrado_en !== null, 'cerrado_en quedó vacío');
  });

  await caso('PATCH de prioridad solo, sin tocar el estado', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T3 }, body: { prioridad: 'ALTA' } }), res);
    const [t] = await fila('SELECT estado, prioridad FROM tickets WHERE id = :id', { id: T3 });
    afirmar(t.prioridad === 'ALTA', `prioridad ${t.prioridad}`);
    afirmar(t.estado === 'ABIERTO', `el estado cambió solo: ${t.estado}`);
  });

  // ── El caso que originó todo esto ───────────────────────────────────────────
  await caso('un estado que el esquema NO admite da 400 con los valores REALES', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: { estado: 'ATENDIDO' } }), res);
    afirmar(res.statusCode === 400, `esperaba 400, fue ${res.statusCode}`);
    afirmar(res.cuerpo.error === 'VALOR_NO_ADMITIDO', `error ${res.cuerpo.error}`);
    afirmar(/CERRADO/.test(res.cuerpo.message), `el mensaje debe listar los valores reales: ${res.cuerpo.message}`);
  });

  await caso('una prioridad inventada da 400 y no un 500', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: { prioridad: 'URGENTISIMA' } }), res);
    afirmar(res.statusCode === 400, `esperaba 400, fue ${res.statusCode}`);
  });

  await caso('PATCH sin nada que cambiar da 400', async () => {
    const res = resFalso();
    await ctrl.actualizarTicket(peticion({ params: { id: T1 }, body: {} }), res);
    afirmar(res.statusCode === 400, `esperaba 400, fue ${res.statusCode}`);
  });

  // ── Respuesta del operador ──────────────────────────────────────────────────
  await caso('responder: guarda el mensaje, mueve el estado y fija la primera respuesta', async () => {
    const res = resFalso();
    await ctrl.responderTicket(peticion({ params: { id: T3 }, body: { mensaje: '  Ya lo revisamos, disculpa.  ' } }), res);
    afirmar(res.statusCode === 201, `status ${res.statusCode} ${JSON.stringify(res.cuerpo)}`);
    afirmar(res.cuerpo.data.correo_enviado === false, 'no debe afirmar que envió correo');
    const [t] = await fila('SELECT estado, primera_respuesta_en FROM tickets WHERE id = :id', { id: T3 });
    afirmar(t.estado === 'ESPERANDO_RESPUESTA_USUARIO', `estado ${t.estado}`);
    afirmar(t.primera_respuesta_en !== null, 'no fijó primera_respuesta_en');
    const [m] = await fila(
      "SELECT mensaje, autor_tipo, es_borrador FROM ticket_mensajes WHERE ticket_id = :id AND autor_tipo = 'OPERADOR'",
      { id: T3 }
    );
    afirmar(m.mensaje === 'Ya lo revisamos, disculpa.', `no recortó los espacios: "${m.mensaje}"`);
    afirmar(m.es_borrador === false, 'la respuesta enviada no puede ser borrador');
  });

  await caso('una segunda respuesta NO mueve el tiempo de primera respuesta', async () => {
    const [antes] = await fila('SELECT primera_respuesta_en FROM tickets WHERE id = :id', { id: T3 });
    const res = resFalso();
    await ctrl.responderTicket(peticion({ params: { id: T3 }, body: { mensaje: 'Un detalle más.' } }), res);
    afirmar(res.statusCode === 201, `status ${res.statusCode}`);
    const [despues] = await fila('SELECT primera_respuesta_en FROM tickets WHERE id = :id', { id: T3 });
    afirmar(
      new Date(antes.primera_respuesta_en).getTime() === new Date(despues.primera_respuesta_en).getTime(),
      'la segunda respuesta sobrescribió el tiempo de la primera'
    );
  });

  await caso('responder con mensaje vacío o solo espacios da 400', async () => {
    const a = resFalso();
    await ctrl.responderTicket(peticion({ params: { id: T4 }, body: { mensaje: '' } }), a);
    afirmar(a.statusCode === 400, `vacío: ${a.statusCode}`);
    const b = resFalso();
    await ctrl.responderTicket(peticion({ params: { id: T4 }, body: { mensaje: '     ' } }), b);
    afirmar(b.statusCode === 400, `espacios: ${b.statusCode}`);
  });

  await caso('responder y cerrar en la misma acción', async () => {
    const res = resFalso();
    await ctrl.responderTicket(
      peticion({ params: { id: T4 }, body: { mensaje: 'Atendida y cerrada.', estado: 'CERRADO' } }),
      res
    );
    afirmar(res.statusCode === 201, `status ${res.statusCode} ${JSON.stringify(res.cuerpo)}`);
    const [t] = await fila('SELECT estado, cerrado_en, primera_respuesta_en FROM tickets WHERE id = :id', { id: T4 });
    afirmar(t.estado === 'CERRADO', `estado ${t.estado}`);
    afirmar(t.cerrado_en !== null, 'no escribió cerrado_en al cerrar');
    afirmar(t.primera_respuesta_en !== null, 'no fijó la primera respuesta al cerrar');
  });

  await caso('responder en un ticket inexistente da 404 (no crea nada)', async () => {
    const res = resFalso();
    await ctrl.responderTicket(
      peticion({ params: { id: '99999999-9999-9999-9999-999999999999' }, body: { mensaje: 'hola' } }),
      res
    );
    afirmar(res.statusCode === 404, `esperaba 404, fue ${res.statusCode}`);
  });

  await caso('un mensaje vacío NO se guardó en el hilo', async () => {
    const [c] = await fila(
      "SELECT count(*)::int AS n FROM ticket_mensajes WHERE mensaje = '' OR mensaje <> btrim(mensaje)"
    );
    afirmar(c.n === 0, `hay ${c.n} mensajes vacíos o con espacios sobrantes`);
  });

  console.log('');
  console.log(`══ ${casos - fallos}/${casos} casos en verde · ${fallos} fallo(s) ══`);
  await sequelize.close();
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Explotó la prueba:', err);
  process.exit(2);
});
