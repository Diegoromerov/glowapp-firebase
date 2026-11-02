/**
 * backend/tests/pqrsfSla.test.js
 *
 * Guard de PQRSF — Fase 1 (cimiento: tiempos de respuesta explícitos).
 *
 * QUÉ PROTEGE
 *   1. Los plazos acordados con el Dueño (D2: tramo estricto). Si alguien los cambia
 *      "un poquito" —lo típico para que un tablero se vea verde—, esto se pone rojo.
 *   2. El cálculo del plazo legal ARCO (Ley 1581/2012): 15 DÍAS HÁBILES, que es donde
 *      un error de fin de semana convierte un plazo legal en un incumplimiento.
 *   3. Que el defecto de la guarda de mensaje vacío no vuelva: `mensaje.trim().isEmpty`
 *      no existe en JS (evaluaba `undefined`, falsy) y dejaba pasar respuestas en
 *      blanco por la ruta que ahora usa el panel.
 *   4. Que el hilo siga declarando el autor de cada mensaje (`autor_tipo`): sin eso no
 *      hay tiempo de respuesta medible ni costura para un agente.
 *
 * SIN DEPENDENCIAS: `fs` / `path` / `assert` de Node. Corre dentro del gate de jest
 * (testMatch `**\/tests\/**\/*.test.js`) y también en solitario:
 *     node backend/tests/pqrsfSla.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  PLAZOS_MINUTOS,
  PRIORIDAD_POR_DEFECTO,
  DIAS_HABILES_ARCO,
  minutosDe,
  fechaLimite,
  estadoSla,
  respondidoATiempo,
  minutosDeRespuesta,
  promedioMinutos,
  sumarDiasHabiles,
  fechaLimiteArco,
  claveDia,
} = require('../src/utils/ticketSla');

const MIN = 60000;
const RAIZ = path.join(__dirname, '..');

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ── Casos ──────────────────────────────────────────────────────────────────────
const registro = [];
const enJest = typeof globalThis.describe === 'function' && typeof globalThis.test === 'function';
const grupo = (nombre, fn) => (enJest ? describe(nombre, fn) : fn());
const caso = (nombre, fn) => {
  if (enJest) return test(nombre, fn);
  registro.push({ nombre, fn });
};

grupo('PQRSF · plazos de respuesta (D2: tramo estricto)', () => {
  caso('los plazos son EXACTAMENTE los acordados: 30min / 2h / 8h / 48h', () => {
    assert.deepStrictEqual(
      { ...PLAZOS_MINUTOS },
      { EMERGENCIA: 30, ALTA: 120, MEDIA: 480, BAJA: 2880 }
    );
  });

  caso('una prioridad desconocida o ausente cae a MEDIA (nunca queda sin vigilar)', () => {
    assert.strictEqual(minutosDe('URGENTISIMA'), PLAZOS_MINUTOS[PRIORIDAD_POR_DEFECTO]);
    assert.strictEqual(minutosDe(undefined), 480);
    assert.strictEqual(minutosDe(null), 480);
  });

  caso('la fecha límite es desde + el plazo de su prioridad', () => {
    const desde = new Date('2026-01-05T12:00:00Z');
    assert.strictEqual(fechaLimite('ALTA', desde).getTime() - desde.getTime(), 120 * MIN);
    assert.strictEqual(fechaLimite('BAJA', desde).getTime() - desde.getTime(), 2880 * MIN);
  });

  caso('el borde del vencimiento: 1 minuto antes NO está vencido, 1 después SÍ', () => {
    const desde = new Date('2026-01-05T12:00:00Z');
    const a = (min) => new Date(desde.getTime() + min * MIN);
    assert.strictEqual(estadoSla('MEDIA', desde, a(479)), 'por_vencer');
    assert.strictEqual(estadoSla('MEDIA', desde, a(481)), 'vencido');
    // justo en el límite todavía no venció
    assert.strictEqual(estadoSla('EMERGENCIA', desde, a(30)), 'por_vencer');
    assert.strictEqual(estadoSla('EMERGENCIA', desde, a(31)), 'vencido');
  });

  caso('"por vencer" es el último cuarto del plazo, no la mitad', () => {
    const desde = new Date('2026-01-05T12:00:00Z');
    const a = (min) => new Date(desde.getTime() + min * MIN);
    // MEDIA = 480 → el aviso empieza en el minuto 360
    assert.strictEqual(estadoSla('MEDIA', desde, a(359)), 'en_plazo');
    assert.strictEqual(estadoSla('MEDIA', desde, a(360)), 'por_vencer');
    // EMERGENCIA = 30 → el aviso empieza en el minuto 22.5, así que el 22 aún no
    assert.strictEqual(estadoSla('EMERGENCIA', desde, a(22)), 'en_plazo');
  });

  caso('con primera respuesta el reloj se para y se puede saber si llegó a tiempo', () => {
    const desde = new Date('2026-01-05T12:00:00Z');
    const dentro = new Date(desde.getTime() + 400 * MIN); // MEDIA = 480
    const fuera = new Date(desde.getTime() + 500 * MIN);
    assert.strictEqual(estadoSla('MEDIA', desde, new Date(desde.getTime() + 999 * MIN), dentro), 'respondido');
    assert.strictEqual(respondidoATiempo('MEDIA', desde, dentro), true);
    assert.strictEqual(respondidoATiempo('MEDIA', desde, fuera), false);
    assert.strictEqual(respondidoATiempo('MEDIA', desde, null), null, 'sin respuesta no hay veredicto');
  });

  caso('métricas: minutos de respuesta y promedio que ignora lo que no es número', () => {
    const desde = new Date('2026-01-05T12:00:00Z');
    assert.strictEqual(minutosDeRespuesta(desde, new Date(desde.getTime() + 400 * MIN)), 400);
    assert.strictEqual(minutosDeRespuesta(desde, null), null);
    assert.strictEqual(promedioMinutos([100, 200, null, undefined, 'x', NaN]), 150);
    assert.strictEqual(promedioMinutos([]), null, 'sin datos no se inventa un 0');
    assert.strictEqual(promedioMinutos([1, 2, 2]), 1.7, 'redondeo a 1 decimal');
  });
});

grupo('PQRSF · plazo legal ARCO (Ley 1581/2012, 15 días hábiles)', () => {
  caso('15 días hábiles desde un lunes son 21 días naturales (3 semanas justas)', () => {
    // 2026-01-05 es lunes; el 15º día hábil es el lunes 2026-01-26.
    const r = fechaLimiteArco(new Date('2026-01-05T09:30:00Z'));
    assert.strictEqual(claveDia(r), '2026-01-26');
  });

  caso('y desde un viernes, 15 días hábiles son el viernes de 3 semanas después', () => {
    const r = fechaLimiteArco(new Date('2026-01-09T15:00:00Z'));
    assert.strictEqual(claveDia(r), '2026-01-30');
  });

  caso('una solicitud que entra en fin de semana cuenta desde el lunes', () => {
    // Sábado 2026-01-10 y viernes 2026-01-09 vencen el MISMO día: el sábado no suma.
    assert.strictEqual(claveDia(fechaLimiteArco(new Date('2026-01-10T11:00:00Z'))), '2026-01-30');
  });

  caso('el resultado NUNCA cae en fin de semana', () => {
    for (let i = 0; i < 40; i += 1) {
      const desde = new Date(Date.UTC(2026, 0, 1 + i, 14, 0, 0));
      const r = fechaLimiteArco(desde);
      const dow = new Date(r.getTime() - 300 * MIN).getUTCDay(); // día colombiano
      assert.ok(dow !== 0 && dow !== 6, `venció en fin de semana: ${claveDia(r)} desde ${claveDia(desde)}`);
    }
  });

  caso('los festivos se pueden inyectar: un festivo corre el plazo un día hábil', () => {
    // Reyes (2026-01-06) cae en martes: sin festivos vence el 26, con festivo el 27.
    assert.strictEqual(claveDia(fechaLimiteArco(new Date('2026-01-05T09:00:00Z'))), '2026-01-26');
    assert.strictEqual(
      claveDia(fechaLimiteArco(new Date('2026-01-05T09:00:00Z'), ['2026-01-06'])),
      '2026-01-27'
    );
  });

  caso('la limitación está DECLARADA: sin festivos, el cálculo no los conoce', () => {
    const fuente = leer('src/utils/ticketSla.js');
    assert.ok(
      /no conoce los festivos colombianos/.test(fuente),
      'el helper debe declarar que sin `festivos` NO conoce los festivos de Colombia'
    );
    assert.strictEqual(DIAS_HABILES_ARCO, 15, 'el plazo legal ARCO son 15 días hábiles');
  });

  caso('sumarDiasHabiles con 0 días no mueve la fecha', () => {
    const desde = new Date('2026-01-05T09:00:00Z');
    assert.strictEqual(sumarDiasHabiles(desde, 0).getTime(), desde.getTime());
  });
});

grupo('PQRSF · las columnas y la guarda que sostienen lo anterior', () => {
  caso('la migración 081 añade las columnas de tiempo y el autor del mensaje', () => {
    const sql = leer('migrations/081_pqrsf_sla_y_autor.sql');
    for (const col of ['primera_respuesta_en', 'resuelto_en', 'cerrado_en']) {
      assert.ok(sql.includes(col), `la migración no añade tickets.${col}`);
    }
    for (const col of ['autor_tipo', 'es_borrador']) {
      assert.ok(sql.includes(col), `la migración no añade ticket_mensajes.${col}`);
    }
    // El CHECK debe admitir a los tres autores: es la costura del agente futuro.
    for (const autor of ['USUARIO', 'OPERADOR', 'AGENTE']) {
      assert.ok(sql.includes(`'${autor}'`), `el CHECK de autor_tipo no admite ${autor}`);
    }
  });

  caso('la migración es idempotente y no usa el valor de enum equivocado', () => {
    const sql = leer('migrations/081_pqrsf_sla_y_autor.sql');
    assert.ok(/IF NOT EXISTS/.test(sql), 'sin IF NOT EXISTS, el reintento de arranque rompería');
    assert.ok(
      !/ATENDIDO/.test(sql),
      "el estado válido es 'RESUELTO', no 'ATENDIDO' (el CHECK de 007 no lo admite)"
    );
  });

  caso('el hilo declara el autor en la lista de COLUMNAS del INSERT', () => {
    const ctrl = leer('src/controllers/ticketController.js');
    // Se mira la lista de columnas del INSERT, no el archivo entero: buscar `autor_tipo`
    // en cualquier parte daba verde aunque el INSERT dejara de escribirlo, porque el
    // `VALUES` de la línea siguiente todavía lo mencionaba.
    const m = /INSERT INTO ticket_mensajes\s*\(([^)]*)\)/s.exec(ctrl);
    assert.ok(m, 'no encontré el INSERT INTO ticket_mensajes');
    const columnas = m[1].split(',').map((c) => c.trim());
    assert.ok(
      columnas.includes('autor_tipo'),
      `el INSERT debe declarar autor_tipo entre sus columnas (declara: ${columnas.join(', ')})`
    );
    assert.ok(
      /is_admin \? 'OPERADOR' : 'USUARIO'/.test(ctrl),
      'el autor del mensaje debe derivarse de si quien responde es admin'
    );
  });

  caso('no vuelve `mensaje.trim().isEmpty`, que no existe en JavaScript', () => {
    const ctrl = leer('src/controllers/ticketController.js');
    assert.ok(
      !/\.trim\(\)\.isEmpty/.test(ctrl),
      '`.isEmpty` no existe en JS: la guarda de mensaje vacío nunca rechazaba nada'
    );
    assert.ok(
      /typeof mensaje !== 'string'/.test(ctrl),
      'la guarda debe rechazar lo que no sea una cadena con contenido'
    );
  });

  caso('la primera respuesta de un operador se registra de forma idempotente', () => {
    const ctrl = leer('src/controllers/ticketController.js');
    assert.ok(
      /primera_respuesta_en = COALESCE\(primera_respuesta_en, NOW\(\)\)/.test(ctrl),
      'sin COALESCE una segunda respuesta sobrescribiría el tiempo de respuesta'
    );
  });
});

// ── Ejecución en solitario (sin jest / sin node_modules) ───────────────────────
if (require.main === module) {
  console.log('══ Guard de PQRSF · plazos y autor ══');
  console.log(`  prioridades : ${JSON.stringify(PLAZOS_MINUTOS)}`);
  console.log(`  ARCO        : ${DIAS_HABILES_ARCO} días hábiles (festivos colombianos: NO incluidos)`);
  console.log('');

  let fallos = 0;
  for (const { nombre, fn } of registro) {
    try {
      fn();
      console.log(`  ✔ ${nombre}`);
    } catch (err) {
      fallos += 1;
      console.log(`  ✘ ${nombre}`);
      console.log(String(err.message).split('\n').map((l) => `      ${l}`).join('\n'));
    }
  }
  console.log('');
  console.log(`══ ${registro.length - fallos}/${registro.length} casos en verde · ${fallos} fallo(s) ══`);
  process.exit(fallos === 0 ? 0 : 1);
}

module.exports = { registro };
