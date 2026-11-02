// backend/src/middleware/tenantContext.js
//
// Establece el contexto de tenant de la petición de forma TRANSACCIONAL.
//
// HISTORIA / POR QUÉ ESTE ARCHIVO CAMBIÓ
// --------------------------------------
// La versión anterior tenía tres defectos independientes, y el contexto de
// tenant NUNCA llegó a aplicarse de verdad en producción:
//
//   1. Creaba su PROPIO pool: `const pool = new Pool({ connectionString })`.
//      Un segundo pool, distinto del de config/db.js. Aunque se hubiera
//      montado, su set_config se habría aplicado a conexiones que ningún
//      controlador utiliza.
//   2. Fijaba el contexto con `pool.query(...)`, un statement suelto. Con
//      is_local = true el ajuste vive solo dentro de esa transacción implícita,
//      así que se evaporaba inmediatamente: no llegaba a ninguna consulta real.
//      El reset posterior asignaba '' — y `''::integer` lanzaría
//      'invalid input syntax for type integer' en toda política que evaluara
//      current_setting('app.tenant_id')::int.
//   3. NO estaba montado en ninguna parte. `src/startup/app.js` solo montaba
//      authMiddleware y rateLimiter; ningún archivo lo importaba. Era código
//      muerto. El único punto que fijaba app.tenant_id era auth.js:44, con
//      is_local = false — esto es, a nivel de sesión y sin reset: una fuga
//      cross-tenant. Ese bloque se ha eliminado.
//
// Ahora el contexto se fija sobre una conexión DEDICADA, dentro de una
// transacción real, con COMMIT/ROLLBACK y release garantizado (ver
// config/tenantRouting.js). Las consultas que usen el `pool` exportado por
// db.js se enrutan a esa conexión, de modo que no hay que reescribir los 335
// call sites existentes.
//
// ACTIVACIÓN
// ----------
// ACTIVO POR DEFECTO. Con TENANT_TRANSACTION_PER_REQUEST ausente este middleware
// abre una transacción dedicada por petición autenticada. Sólo se desactiva con
// TENANT_TRANSACTION_PER_REQUEST=false, y en producción ese valor se ignora: el
// aislamiento por inquilino es obligatorio (ver config/tenantRouting.js,
// isPerRequestTransactionEnabled). Con el modo desactivado el middleware es un
// passthrough: no abre conexión ni transacción, y el comportamiento de la app
// es idéntico al anterior.
//
// ORDEN DEL COMMIT
// -----------------
// El COMMIT se hace ANTES de enviar la respuesta JSON. Antes se hacía en el
// evento 'finish' —con la respuesta ya en el socket— y eso producía un fallo
// real, no teórico: un cliente que escribe y vuelve a leer de inmediato (la app
// al aceptar el contrato, cualquier flujo de dinero) veía su propia escritura
// como ausente, porque el COMMIT aún no había ocurrido. Lo detectó el arnés E2E
// de reglas del dinero como fallo intermitente (B3, 1 de cada N corridas).
// Además, si el COMMIT falla, el cliente recibía 200 sobre una escritura
// revertida: eso es lo que ahora se convierte en error.
//
// El cuerpo JSON se difiere hasta que la transacción termina. 'finish' y
// 'close' siguen como respaldo para las respuestas que no pasan por res.json
// (streaming, res.end, cliente que corta).

const { pool } = require('../config/db');
const tenantRouting = require('../config/tenantRouting');

async function tenantContextMiddleware(req, res, next) {
  // Sin usuario o sin tenant no hay contexto que fijar. No se abre transacción:
  // encarecería las peticiones públicas, y las políticas usan
  // current_setting('app.tenant_id', true), de modo que sin contexto devuelven
  // 0 filas en lugar de lanzar error.
  if (!req.user || !req.user.tenant_id) {
    return next();
  }

  // Modo por defecto: sin transacción por petición. El aislamiento efectivo lo
  // aplica la capa de aplicación (066). Aquí es un passthrough explícito.
  if (!tenantRouting.isPerRequestTransactionEnabled()) {
    return next();
  }

  // Arnés de tests: muchas suites sustituyen config/db por un doble mínimo
  // ({ query }) que no puede abrir una conexión dedicada. Sin esta salida, cada
  // petición autenticada de esas suites respondería 500 («pool.connect is not a
  // function») y el fallo mediría el doble, no el código. En producción se
  // mantiene el cierre fail-closed: un pool sin connect ahí es un error de
  // configuración y debe reventar, no degradarse en silencio.
  if (typeof pool.connect !== 'function') {
    if (process.env.NODE_ENV === 'production') {
      return next(new Error('tenantContext: el pool no expone connect() en producción'));
    }
    return next();
  }

  // Marca si ya se cedió el control a la cadena de la aplicación. Sirve para
  // distinguir un fallo AL MONTAR la transacción (BEGIN/set_config: no se puede
  // servir la petición con seguridad -> 500) de un fallo DE LA CADENA de
  // aplicación, que debe reenviarse a Express en vez de enmascararse con un 500
  // genérico.
  let cadenaIniciada = false;

  // Se guardan las implementaciones reales de Express: la respuesta diferida
  // las necesita para escribir cuando la transacción ya terminó, y los caminos
  // de error las restauran para no dejar la respuesta secuestrada.
  // Los dobles de pruebas no siempre implementan res.send; sin esta guarda el
  // middleware reventaría midiendo el doble, no el código.
  // Se guarda la función ORIGINAL (sin bind) para poder restaurar exactamente el
  // mismo objeto: si se restaurara una copia ligada, un espía de jest dejaría de
  // serlo y las aserciones sobre res.json se romperían.
  const jsonOriginal = typeof res.json === 'function' ? res.json : null;
  const sendOriginal = typeof res.send === 'function' ? res.send : null;
  const restaurarRespuesta = () => {
    if (jsonOriginal) res.json = jsonOriginal;
    if (sendOriginal) res.send = sendOriginal;
  };

  let respuestaDiferida = null;
  let terminarTransaccion = null;

  // Difiere el cuerpo hasta después del COMMIT. Sin esto la respuesta sale por
  // el socket con la transacción todavía abierta y el cliente puede leer su
  // propia escritura como ausente.
  const diferir = (tipo, cuerpo, escribirOriginal) => {
    if (respuestaDiferida) return res;
    // Respuesta ya iniciada (streaming, sendFile): no se puede diferir.
    if (res.headersSent) return escribirOriginal(cuerpo);
    respuestaDiferida = { tipo, cuerpo, status: res.statusCode, escribirOriginal };
    if (terminarTransaccion) terminarTransaccion();
    return res;
  };

  if (jsonOriginal) res.json = (cuerpo) => diferir('json', cuerpo, () => jsonOriginal.call(res, cuerpo));
  if (sendOriginal) res.send = (cuerpo) => diferir('send', cuerpo, () => sendOriginal.call(res, cuerpo));

  try {
    await tenantRouting.runInTenantTransaction({ pool }, req.user.tenant_id, () =>
      new Promise((resolve, reject) => {
        let resuelto = false;
        const finalizar = (error) => {
          if (resuelto) return;
          resuelto = true;
          if (error) reject(error);
          else resolve();
        };
        // Se expone para que res.json/res.send puedan cerrar la transacción
        // antes de escribir.
        terminarTransaccion = () => finalizar();

        // Respaldo para las respuestas que no pasan por res.json/res.send:
        // 'finish' (respuesta enviada por otra vía) y 'close' (el cliente cortó).
        res.on('finish', () => finalizar());
        res.on('close', () => finalizar());

        cadenaIniciada = true;
        try {
          next();
        } catch (errorCadena) {
          // Express no puede capturar un throw lanzado desde dentro de este
          // ejecutor de promesa: hay que propagarlo a mano.
          finalizar(errorCadena);
        }
      })
    );

    // La transacción ya hizo COMMIT. Recién ahora se envía el cuerpo diferido.
    if (respuestaDiferida) {
      const { cuerpo, status, escribirOriginal } = respuestaDiferida;
      respuestaDiferida = null;
      restaurarRespuesta();
      // Si otro middleware ya respondió (o el cliente cortó), no se escribe:
      // hacerlo reventaría con «headers already sent» sobre un error ajeno.
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        res.statusCode = status;
        escribirOriginal(cuerpo);
      }
    }
  } catch (error) {
    // Si la transacción no terminó bien, no se envía el cuerpo del controlador:
    // era una escritura que quedó revertida.
    restaurarRespuesta();
    respuestaDiferida = null;
    if (cadenaIniciada) {
      // El fallo pertenece a la cadena de la aplicación.
      return next(error);
    }

    // El doble de config/db no puede entregar una conexión dedicada: no es un
    // fallo de la aplicación. En producción un pool sin cliente utilizable sí es
    // un error de configuración, y no se degrada.
    if (error.code === 'SIN_CLIENTE_DEDICADO' && process.env.NODE_ENV !== 'production') {
      return next();
    }

    console.error('❌ tenantContext: fallo al montar la transacción:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
}

module.exports = tenantContextMiddleware;
