// backend/src/services/transactionStore.js
//
// Persistencia de la transacción pendiente de un pedido de tienda.
//
// Vive fuera de orderController por dos razones:
//   1. `tenant_id` es obligatorio en la práctica: `transactions` tiene RLS con
//      FORCE, así que una fila sin tenant_id sólo es visible para superusuarios.
//      El día que la API conecte como `app_rls_user` (que es el objetivo de
//      RLS_ROLE_PASSWORD), el webhook de Wompi no encontraría la transacción y un
//      pago aprobado no cerraría el pedido.
//   2. Al recibir el `client` por parámetro se puede probar con un stub, sin
//      levantar HTTP ni cargar el cliente de la DIAN.

/**
 * Inserta la transacción pendiente de un pedido de tienda.
 *
 * `external_id` debe ser el id de la transacción en Wompi: storeWebhook busca la
 * fila por ese valor (`WHERE external_id = $1`). Guardar ahí la referencia
 * dejaba el pedido sin poder cerrarse nunca.
 *
 * @param {{ query: Function }} client pool o cliente dentro de una transacción
 * @param {object} datos
 * @param {number} datos.userId comprador
 * @param {number} datos.amount monto en pesos (no centavos)
 * @param {string} datos.method método de pago Wompi (CARD, NEQUI, PSE…)
 * @param {string} datos.wompiId id de la transacción devuelto por Wompi
 * @param {string} datos.reference referencia propia enviada a Wompi
 * @param {number|null} [datos.tenantId] tenant del pedido
 * @returns {Promise<object>} la fila insertada
 */
async function insertPendingTransaction(client, {
  userId,
  amount,
  method,
  wompiId,
  reference,
  tenantId = null,
}) {
  const res = await client.query(
    `INSERT INTO transactions
       (booking_id, client_id, provider_id, amount, monto_total, comision_plataforma,
        monto_neto_prestador, impuestos_retencion, status, payment_method, external_id,
        pasarela_pago, referencia_pasarela, estado_pago, liberado_al_prestador, tenant_id)
     VALUES (NULL, $1, NULL, $2, $2, 0, $2, 0, 'pending', $3, $4, 'wompi', $5, 'pending', false, $6)
     RETURNING *;`,
    [userId, amount, method, wompiId, reference, tenantId]
  );
  return res.rows[0];
}

module.exports = { insertPendingTransaction };
