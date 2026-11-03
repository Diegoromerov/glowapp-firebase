/**
 * backend/tests/adminTickets.test.js
 *
 * Guard de PQRSF — Fase 2 (endpoints de gestión desde el panel).
 *
 * QUÉ PROTEGE
 *   1. Que la validación de estado/prioridad salga del ESQUEMA REAL y no de una lista
 *      escrita en el controlador. El botón "Atender" de SOS no estaba roto: el
 *      controlador escribía un valor que el CHECK no admitía y el fallo llegaba como 500.
 *      Aquí se fija con las definiciones de CHECK literales que produce Postgres.
 *   2. Que los plazos de SLA tengan UNA sola fuente (`PLAZOS_MINUTOS`) también en las
 *      métricas SQL: dos copias divergen y la métrica mide contra el plazo viejo.
 *   3. Lo que la Fase 2 cierra de la Fase 1: `resuelto_en`/`cerrado_en` (que hasta ahora
 *      solo tenían el valor del backfill) y el tiempo de primera respuesta.
 *   4. Que la bandeja no se pueda montar sin guardia de rol, y que `/tickets/metricas`
 *      no quede tapada por `/tickets/:id`.
 *
 * SIN DEPENDENCIAS: `fs` / `path` / `assert`. Corre dentro del gate de jest (testMatch
 * `**\/tests\/**\/*.test.js`) y también en solitario:
 *     node backend/tests/adminTickets.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  valoresDeDefinicion,
  definicionesDeColumna,
} = require('../src/utils/ticketEsquema');
const {
  PLAZOS_MINUTOS,
  PRIORIDAD_POR_DEFECTO,
  diasHabilesEntre,
  casePlazoMinutos,
} = require('../src/utils/ticketSla');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const CTRL = leer('backend/src/controllers/adminTicketController.js');
const RUTAS = leer('backend/src/routes/adminTicketRoutes.js');
const BFF = leer('admin-dashboard/src/app/api/[...path]/route.ts');

// ── Definiciones de CHECK COPIADAS VERBATIM de Postgres 16 ─────────────────────
// (`pg_get_constraintdef` sobre `tickets`, tras aplicar 007 + 045). No son inventadas:
// así la prueba del parser se ancla a la forma que produce la base de verdad.
const DEF_ESTADO = "CHECK (((estado)::text = ANY ((ARRAY['ABIERTO'::character varying, 'EN_PROCESO'::character varying, 'ESPERANDO_RESPUESTA_USUARIO'::character varying, 'RESUELTO'::character varying, 'CERRADO'::character varying])::text[])))";
const DEF_PRIORIDAD = "CHECK (((prioridad)::text = ANY ((ARRAY['BAJA'::character varying, 'MEDIA'::character varying, 'ALTA'::character varying, 'EMERGENCIA'::character varying])::text[])))";
const DEF_TIPO = "CHECK (((tipo)::text = ANY ((ARRAY['PETICION'::character varying, 'QUEJA'::character varying, 'RECLAMO'::character varying, 'SUGERENCIA'::character varying, 'FELICITACION'::character varying, 'ARCO_SUPRESION'::character varying])::text[])))";
const DEF_CATEGORIA = "CHECK (((categoria)::text = ANY ((ARRAY['pago'::character varying, 'servicio'::character varying, 'app'::character varying, 'seguridad'::character varying, 'otros'::character varying])::text[])))";
const DEFINICIONES = [DEF_CATEGORIA, DEF_ESTADO, DEF_PRIORIDAD, DEF_TIPO];

/**
 * Fuente SIN las líneas de comentario. Una línea comentada no es código: un guardián que
 * mira el texto crudo se conforma con un comentario, y eso ya pasó (un valor de enum
 * prohibido sobrevivía dentro de la explicación que decía haberlo quitado, y aquí mismo
 * `router.use(requireRol('admin'))` comentado seguía dando verde).
 */
const sinComentarios = (fuente) =>
  fuente
    .split('\n')
    .filter((linea) => {
      const l = linea.trim();
      return !(l.startsWith('//') || l.startsWith('*') || l.startsWith('/*'));
    })
    .join('\n');

const CTRL_CODIGO = sinComentarios(CTRL);
const RUTAS_CODIGO = sinComentarios(RUTAS);

/**
 * Cuerpo de un handler concreto. Sin esto, una aserción sobre el archivo entero se
 * satisface con código parecido de OTRO handler: quitar el borrado de `resuelto_en` del
 * PATCH daba verde porque `responderTicket` tenía la misma línea.
 */
function cuerpoDe(fuente, nombre) {
  const marca = `exports.${nombre} = async`;
  const i = fuente.indexOf(marca);
  if (i === -1) return null;
  const j = fuente.indexOf('\nexports.', i + marca.length);
  return fuente.slice(i, j === -1 ? fuente.length : j);
}

const registro = [];
const enJest = typeof globalThis.describe === 'function' && typeof globalThis.test === 'function';
const grupo = (nombre, fn) => (enJest ? describe(nombre, fn) : fn());
const caso = (nombre, fn) => {
  if (enJest) return test(nombre, fn);
  registro.push({ nombre, fn });
};

grupo('PQRSF · los valores admisibles salen del esquema, no del controlador', () => {
  caso('parsea la definición real de estado: exactamente los 5 estados', () => {
    assert.deepStrictEqual(valoresDeDefinicion(DEF_ESTADO), [
      'ABIERTO',
      'EN_PROCESO',
      'ESPERANDO_RESPUESTA_USUARIO',
      'RESUELTO',
      'CERRADO',
    ]);
  });

  caso('parsea tipo e incluye ARCO_SUPRESION (el valor que añadió la migración 045)', () => {
    const tipos = valoresDeDefinicion(DEF_TIPO);
    assert.ok(
      tipos.includes('ARCO_SUPRESION'),
      'una lista escrita a mano en el código se habría perdido este valor'
    );
    assert.strictEqual(tipos.length, 6);
  });

  caso('no cuela nombres de tipo como si fueran valores admisibles', () => {
    for (const definicion of DEFINICIONES) {
      const valores = valoresDeDefinicion(definicion);
      assert.ok(!valores.includes('character varying'), 'coló "character varying"');
      assert.ok(!valores.includes('text'), 'coló "text"');
    }
  });

  caso('cada columna se queda con SU definición, sin mezclar', () => {
    assert.deepStrictEqual(definicionesDeColumna(DEFINICIONES, 'prioridad'), [DEF_PRIORIDAD]);
    assert.deepStrictEqual(definicionesDeColumna(DEFINICIONES, 'estado'), [DEF_ESTADO]);
    const prioridades = valoresDeDefinicion(definicionesDeColumna(DEFINICIONES, 'prioridad')[0]);
    assert.deepStrictEqual(prioridades, ['BAJA', 'MEDIA', 'ALTA', 'EMERGENCIA']);
  });

  caso('el controlador valida contra el esquema y no con una lista propia', () => {
    for (const handler of ['actualizarTicket', 'responderTicket']) {
      const cuerpo = cuerpoDe(CTRL_CODIGO, handler) || '';
      assert.ok(
        /motivoInvalido\(\s*'tickets',\s*'estado'/.test(cuerpo),
        `${handler} debe validar 'estado' contra el esquema`
      );
    }
    assert.ok(
      /motivoInvalido\(\s*'tickets',\s*'prioridad'/.test(cuerpoDe(CTRL_CODIGO, 'actualizarTicket') || ''),
      'actualizarTicket debe validar prioridad contra el esquema'
    );
    // Una lista literal de valores admisibles es justo lo que se desincroniza: se busca
    // la forma de ARRAY, que es como aparecería una lista de validación.
    assert.ok(
      !/\['ABIERTO'|\[\s*'EMERGENCIA'|\[\s*'PETICION'/.test(CTRL_CODIGO),
      'el controlador no debe llevar una lista literal de estados/prioridades/tipos'
    );
  });

  caso('los estados que usan las transiciones existen en el esquema real', () => {
    // Si una migración futura renombra RESUELTO o CERRADO, la regla de transición se
    // quedaría muda sin que nadie se entere. Esto lo pone rojo.
    const estados = valoresDeDefinicion(DEF_ESTADO);
    for (const usado of ['RESUELTO', 'CERRADO']) {
      assert.ok(estados.includes(usado), `la transición nombra '${usado}', que el esquema ya no admite`);
      assert.ok(CTRL_CODIGO.includes(`'${usado}'`), `el controlador dejó de usar '${usado}'`);
    }
  });
});

grupo('PQRSF · los plazos tienen una sola fuente', () => {
  caso('la expresión SQL de los plazos se construye desde PLAZOS_MINUTOS', () => {
    const sql = casePlazoMinutos();
    for (const [prioridad, minutos] of Object.entries(PLAZOS_MINUTOS)) {
      assert.ok(
        sql.includes(`WHEN '${prioridad}' THEN ${minutos}`),
        `el CASE no deriva '${prioridad}' (${minutos} min) del helper`
      );
    }
    assert.ok(
      sql.includes(`ELSE ${PLAZOS_MINUTOS[PRIORIDAD_POR_DEFECTO]}`),
      'una prioridad desconocida debe caer al plazo por defecto, no a un número suelto'
    );
  });

  caso('la expresión permite elegir la columna (no está clavada a una tabla)', () => {
    assert.ok(casePlazoMinutos('x.prioridad').includes('CASE x.prioridad'));
  });

  caso('cada comparación de vencimiento usa la expresión derivada, no un número suelto', () => {
    // La propiedad que importa: donde se decide si algo venció, el plazo sale del helper.
    const comparaciones = CTRL_CODIGO.match(/NOW\(\) > t\.fecha_creacion \+ \(/g) || [];
    const usos = CTRL_CODIGO.match(/casePlazoMinutos\('t\.prioridad'\)/g) || [];
    assert.ok(comparaciones.length >= 2, `esperaba el filtro de vencidos y las métricas; vi ${comparaciones.length}`);
    assert.strictEqual(
      comparaciones.length,
      usos.length,
      'toda comparación de vencimiento debe construirse con casePlazoMinutos(); hay una con el plazo escrito a mano'
    );
  });
});

grupo('PQRSF · lo que la Fase 2 cierra de la Fase 1', () => {
  caso('el PATCH escribe resuelto_en y cerrado_en (los que solo tenía el backfill)', () => {
    const patch_ = cuerpoDe(CTRL_CODIGO, 'actualizarTicket') || '';
    assert.ok(/resuelto_en = NOW\(\)/.test(patch_), 'el PATCH no escribe resuelto_en');
    assert.ok(/cerrado_en = NOW\(\)/.test(patch_), 'el PATCH no escribe cerrado_en');
  });

  caso('al reabrir se limpian: un ticket reabierto no puede contar como resuelto', () => {
    for (const handler of ['actualizarTicket', 'responderTicket']) {
      assert.ok(
        /resuelto_en = NULL', 'cerrado_en = NULL/.test(cuerpoDe(CTRL_CODIGO, handler) || ''),
        `${handler} debe limpiar ambos sellos al volver a un estado abierto`
      );
    }
  });

  caso('responder fija la primera respuesta de forma idempotente', () => {
    assert.ok(
      /primera_respuesta_en = COALESCE\(primera_respuesta_en, NOW\(\)\)/.test(
        cuerpoDe(CTRL_CODIGO, 'responderTicket') || ''
      ),
      'sin COALESCE, una segunda respuesta reescribiría el tiempo de respuesta'
    );
  });

  caso('la respuesta entra en el hilo como OPERADOR y no como borrador', () => {
    const m = /INSERT INTO ticket_mensajes\s*\(([^)]*)\)[^']*VALUES\s*\(([^)]*)\)/s.exec(
      cuerpoDe(CTRL_CODIGO, 'responderTicket') || ''
    );
    assert.ok(m, 'no encontré el INSERT del hilo en el controlador');
    const columnas = m[1].split(',').map((c) => c.trim());
    assert.ok(columnas.includes('autor_tipo'), `el INSERT debe declarar autor_tipo (declara: ${columnas.join(', ')})`);
    assert.ok(columnas.includes('es_borrador'), 'el INSERT debe declarar es_borrador');
    assert.ok(/'OPERADOR'/.test(m[2]), 'la respuesta del panel debe entrar como OPERADOR');
    assert.ok(/FALSE/.test(m[2]), 'una respuesta enviada no es un borrador');
  });

  caso('el mensaje y el cambio de estado van en una transacción', () => {
    assert.ok(
      /sequelize\.transaction\(/.test(cuerpoDe(CTRL_CODIGO, 'responderTicket') || ''),
      'si se guardara solo uno de los dos, el hilo diría que se respondió y el ticket seguiría abierto'
    );
  });

  caso('un borrador NO cuenta como respuesta del operador', () => {
    assert.ok(
      /autor_tipo IN \('OPERADOR','AGENTE'\)\s*\n?\s*AND m\.es_borrador = FALSE/.test(
        cuerpoDe(CTRL_CODIGO, 'listarTickets') || ''
      ),
      'el contador de respuestas debe excluir los borradores'
    );
  });

  caso('la prioridad se puede fijar al crear (defecto E de la auditoría)', () => {
    const ctrl = leer('backend/src/controllers/ticketController.js');
    assert.ok(/const \{ booking_id, tipo, categoria, asunto, descripcion, evidencia_urls, prioridad \} = req.body/.test(ctrl), 'createTicket no lee prioridad');
    assert.ok(/conPrioridad \? ', prioridad' : ''/.test(ctrl), 'createTicket no escribe la prioridad en el INSERT');
    assert.ok(/motivoInvalido\('tickets', columna, valor\)/.test(ctrl), 'createTicket no valida tipo/categoria contra el esquema');
    assert.ok(/error\.code === '23514'/.test(ctrl), 'la violación del CHECK debe salir como 400, no como 500');
  });
});

grupo('PQRSF · rutas, guardias y auditoría', () => {
  caso('el guardia de rol es del router entero: ninguna ruta puede quedar sin él', () => {
    assert.ok(/router\.use\(authMiddleware\);/.test(RUTAS_CODIGO), 'falta authMiddleware a nivel de router');
    assert.ok(/router\.use\(requireRol\('admin'\)\);/.test(RUTAS_CODIGO), 'falta requireRol(admin) a nivel de router');
    const rutas = RUTAS_CODIGO.match(/router\.(get|post|patch|put|delete)\(/g) || [];
    assert.strictEqual(rutas.length, 6, `esperaba 6 rutas, hay ${rutas.length}`);
  });

  caso('ningún camino con nombre propio queda DETRÁS de /tickets/:id', () => {
    // Si '/tickets/:id' va primero, 'metricas' y 'esquema' se leen como un id y mueren en
    // el guardia de formato: la petición falla con 400 y el síntoma es "el panel no carga
    // las opciones", no un 404 que delate el orden.
    const iDetalle = RUTAS_CODIGO.indexOf("'/tickets/:id'");
    assert.ok(iDetalle !== -1, 'no existe la ruta de detalle');
    for (const camino of ['/tickets/metricas', '/tickets/esquema']) {
      const i = RUTAS_CODIGO.indexOf(`'${camino}'`);
      assert.ok(i !== -1, `no existe la ruta ${camino}`);
      assert.ok(i < iDetalle, `'${camino}' debe declararse antes que '/tickets/:id'`);
    }
  });

  caso('la bandeja no reutiliza la clave del hilo para un conteo', () => {
    // `mensajes` es el ARRAY del hilo en el detalle. Que la bandeja devolviera un NÚMERO
    // bajo la misma clave daba dos tipos para una clave: el panel que herede la fila y
    // reuse el tipo en el detalle declara número donde llega una lista.
    const bandeja = cuerpoDe(CTRL_CODIGO, 'listarTickets') || '';
    assert.ok(
      /AS mensajes_total\b/.test(bandeja),
      'el conteo de la bandeja debe llamarse mensajes_total'
    );
    assert.ok(
      !/AS mensajes\b(?!_total)/.test(bandeja),
      'un `AS mensajes` en la bandeja choca con el array del detalle'
    );
    assert.ok(
      /ORDER BY m\.fecha_envio ASC/.test(cuerpoDe(CTRL_CODIGO, 'detalleTicket') || ''),
      'en el detalle, `mensajes` debe seguir siendo la colección del hilo'
    );
  });

  caso('las opciones del panel salen del esquema, no de una lista del controlador', () => {
    const cuerpo = cuerpoDe(CTRL_CODIGO, 'esquemaTickets') || '';
    assert.ok(cuerpo, 'no existe el handler de esquema');
    for (const columna of ['estado', 'prioridad', 'tipo', 'categoria']) {
      assert.ok(
        new RegExp(`valoresValidos\\(\\s*'tickets',\\s*'${columna}'`).test(cuerpo),
        `los valores de ${columna} deben derivarse del esquema`
      );
    }
    assert.ok(
      !/\[\s*'ABIERTO'|\[\s*'EMERGENCIA'|\[\s*'PETICION'/.test(cuerpo),
      'el handler de esquema no debe llevar una lista literal de valores'
    );
    assert.ok(
      /plazos_minutos: PLAZOS_MINUTOS/.test(cuerpo),
      'los plazos también se sirven desde el helper, no copiados en el panel'
    );
  });

  caso('las dos escrituras quedan auditadas', () => {
    assert.ok(/adminAuditLog\(\{ action: 'tickets\.actualizar'/.test(RUTAS_CODIGO), 'el PATCH no se audita');
    assert.ok(/adminAuditLog\(\{ action: 'tickets\.responder'/.test(RUTAS_CODIGO), 'la respuesta no se audita');
  });

  caso('el panel puede alcanzar los endpoints (allowlist del BFF)', () => {
    // Sin un prefijo que cubra 'admin/', el proxy del panel responde 404 y la pantalla
    // aparece vacía sin ningún error del backend. Ya pasó con /api/v1/business/*.
    assert.ok(
      /'admin\/'/.test(BFF),
      "la allowlist del BFF debe cubrir 'admin/' o el panel no verá /api/admin/tickets"
    );
    assert.ok(/'tickets\//.test(BFF) || /'admin\/'/.test(BFF), 'admin/tickets debe estar cubierto');
  });

  caso('la violación de CHECK se traduce a 400 en todos los handlers que escriben', () => {
    assert.ok(/error\.code === '23514'/.test(CTRL), 'falta el mapeo de 23514');
    assert.ok(/error\.code === '22P02'/.test(CTRL), 'falta el mapeo de uuid inválido');
    assert.ok(
      /VALOR_NO_ADMITIDO/.test(CTRL_CODIGO),
      'el rechazo debe decir que el valor no está admitido, no un error genérico'
    );
  });

  caso('la bandeja respeta la forma de paginación de la casa', () => {
    assert.ok(/success: true,\s*\n\s*page: pagina,\s*\n\s*limit: limite,\s*\n\s*total,/.test(CTRL_CODIGO),
      'la respuesta debe ser {success, page, limit, total, data}');
  });
});

grupo('PQRSF · días hábiles (plazo legal ARCO)', () => {
  caso('de lunes a lunes siguiente hay 5 días hábiles', () => {
    assert.strictEqual(
      diasHabilesEntre(new Date('2026-01-05T09:00:00Z'), new Date('2026-01-12T09:00:00Z')),
      5
    );
  });

  caso('de sábado a lunes hay 1', () => {
    assert.strictEqual(
      diasHabilesEntre(new Date('2026-01-10T09:00:00Z'), new Date('2026-01-12T09:00:00Z')),
      1
    );
  });

  caso('hacia atrás es negativo, para saber cuánto se pasó', () => {
    assert.strictEqual(
      diasHabilesEntre(new Date('2026-01-12T09:00:00Z'), new Date('2026-01-05T09:00:00Z')),
      -5
    );
  });

  caso('un festivo inyectado descuenta un día hábil', () => {
    assert.strictEqual(
      diasHabilesEntre(new Date('2026-01-05T09:00:00Z'), new Date('2026-01-12T09:00:00Z'), ['2026-01-06']),
      4
    );
  });

  caso('el mismo día son 0, y no un día por redondeo', () => {
    assert.strictEqual(
      diasHabilesEntre(new Date('2026-01-05T09:00:00Z'), new Date('2026-01-05T23:00:00Z')),
      0
    );
  });
});

// ── Ejecución en solitario (sin jest / sin node_modules) ───────────────────────
if (require.main === module) {
  console.log('══ Guard de PQRSF · endpoints de gestión (Fase 2) ══');
  console.log(`  plazos : ${JSON.stringify(PLAZOS_MINUTOS)}`);
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
