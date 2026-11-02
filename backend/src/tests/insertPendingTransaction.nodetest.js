// El INSERT de transactions no escribía tenant_id. Con RLS FORCE activo en la
// tabla, esa fila queda invisible para cualquier rol que no sea superusuario:
// el webhook no encuentra la transacción y un pago aprobado nunca cierra.
//
// Se ejecuta con `node --test` (convención *.nodetest.js del repo) para no
// depender de Babel/jest en local.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// El módulo recibe el cliente por parámetro, así que no hay que cargar el
// controlador (ni la DIAN, ni Wompi) para probarlo.
const { insertPendingTransaction } = require(
  path.join(__dirname, '..', 'services', 'transactionStore')
);

function clienteEspia() {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return { rows: [{ id: 99 }] };
    },
  };
}

test('insertPendingTransaction escribe tenant_id en la fila de la transacción', async () => {
  const client = clienteEspia();

  await insertPendingTransaction(client, {
    userId: 7,
    amount: 45000,
    method: 'CARD',
    wompiId: 'wompi-123',
    reference: 'wompi_order_abc_001',
    tenantId: 2,
  });

  const { sql, params } = client.llamadas[0];
  assert.match(sql, /INSERT INTO transactions/i);
  assert.match(sql, /tenant_id/);
  assert.equal(params[5], 2);
});

test('guarda el id de Wompi en external_id (el webhook busca por ahí)', async () => {
  const client = clienteEspia();

  await insertPendingTransaction(client, {
    userId: 7,
    amount: 1000,
    method: 'CARD',
    wompiId: 'wompi-xyz',
    reference: 'ref',
    tenantId: 1,
  });

  assert.equal(client.llamadas[0].params[3], 'wompi-xyz');
});

test('acepta tenantId nulo sin romper', async () => {
  const client = clienteEspia();

  await insertPendingTransaction(client, {
    userId: 7,
    amount: 1000,
    method: 'CARD',
    wompiId: 'w',
    reference: 'r',
  });

  assert.equal(client.llamadas[0].params[5], null);
});
