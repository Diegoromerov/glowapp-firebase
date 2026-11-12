/**
 * Reversión del premio de referidos cuando el pedido de origen se reembolsa.
 *
 * Condiciones publicadas: «Si el pedido se reembolsa dentro de los 30 días
 * siguientes, el premio que generó se revierte hasta lo que no se haya gastado.»
 * Hasta hoy `revertir()` existía y nadie la llamaba: esto fija el enganche.
 */
const { revertirPremioDePedido } = require('../src/services/pointsService');

function clienteGuionado(respuestas) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const r = respuestas.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('revertirPremioDePedido', () => {
  test('revierte hasta lo que queda del lote del premio', async () => {
    const cliente = clienteGuionado([
      { rows: [{ id: 11, puntos_restantes: 300 }] },        // lote bloqueado
      { rows: [{ id: 5 }], rowCount: 1 },                    // movimiento de reversión
      { rowCount: 1 },                                       // descuento del lote
    ]);

    const r = await revertirPremioDePedido({ pedidoId: 42, cliente });

    expect(r.revertido).toBe(300);
    expect(r.sinPremio).toBe(false);
    expect(cliente.calls[0].sql).toMatch(/points_lots/);
    expect(cliente.calls[0].params).toEqual(['referido:compra', 42]);
    expect(cliente.calls[1].params[0]).toBe('reversion:referido:compra:42');
  });

  test('informa lo no cubierto cuando ya se gastó parte del premio', async () => {
    const cliente = clienteGuionado([
      { rows: [{ id: 11, puntos_restantes: 200 }] },
      { rows: [{ id: 5 }], rowCount: 1 },
      { rowCount: 1 },
    ]);

    const r = await revertirPremioDePedido({ pedidoId: 42, cliente, puntos: 500 });

    expect(r.revertido).toBe(200);
    expect(r.noCubierto).toBe(300);
  });

  test('un pedido que nunca generó premio no lanza: sinPremio', async () => {
    const cliente = clienteGuionado([{ rows: [] }]);

    const r = await revertirPremioDePedido({ pedidoId: 999, cliente });

    expect(r).toEqual({ revertido: 0, noCubierto: 0, sinPremio: true });
  });

  test('con el lote ya en cero no escribe movimiento', async () => {
    const cliente = clienteGuionado([{ rows: [{ id: 11, puntos_restantes: 0 }] }]);

    const r = await revertirPremioDePedido({ pedidoId: 42, cliente });

    expect(r.revertido).toBe(0);
    expect(r.sinPremio).toBe(false);
    expect(cliente.calls).toHaveLength(1);
  });
});
