'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { consumirInsumosDeReserva } = require('../services/salonInventoryService');

function dbFalso({ receta = [], consumosPrevios = [] } = {}) {
  const llamadas = [];
  const consumidos = new Set(consumosPrevios);
  let stock = new Map(receta.map((r) => [r.item_id, Number(r.stock_actual)]));
  return {
    llamadas,
    get stock() { return stock; },
    query: async (sql, params) => {
      const limpio = sql.replace(/\s+/g, ' ').trim();
      llamadas.push({ sql: limpio, params });
      if (/FROM salon_servicio_insumos si/i.test(limpio)) return { rows: receta };
      if (/FROM inventario_consumos_reserva/i.test(limpio)) {
        return { rows: consumidos.has(String(params[1])) ? [{ id: 'consumo-1' }] : [] };
      }
      if (/UPDATE inventario_salon/i.test(limpio)) {
        stock.set(String(params[1]), stock.get(String(params[1])) - Number(params[0]));
      }
      if (/INSERT INTO inventario_consumos_reserva/i.test(limpio)) consumidos.add(String(params[4]));
      return { rows: [] };
    },
  };
}

test('consume recipe quantities and keeps inventory movement linked to the booking', async () => {
  const db = dbFalso({ receta: [{ item_id: 'item-1', cantidad_solicitada: '2.5', stock_actual: '5', nombre: 'Tinte', unidad: 'ml' }] });
  const result = await consumirInsumosDeReserva(db, {
    bookingId: 'booking-1', serviceId: 'service-1', salonId: 10, tenantId: 'tenant-1', actorId: 2,
  });
  assert.deepEqual(result, { consumidos: 1, faltantes: 0 });
  assert.equal(db.stock.get('item-1'), 2.5);
  assert.ok(db.llamadas.some((q) => /FOR UPDATE OF si, i/.test(q.sql)));
  assert.ok(db.llamadas.some((q) => /INSERT INTO inventario_movimientos/.test(q.sql) && q.params[8] === 'booking-1'));
});

test('records shortage without negative stock or blocking completion', async () => {
  const db = dbFalso({ receta: [{ item_id: 'item-1', cantidad_solicitada: '3', stock_actual: '1', nombre: 'Tinte', unidad: 'ml' }] });
  const result = await consumirInsumosDeReserva(db, {
    bookingId: 'booking-2', serviceId: 'service-1', salonId: 10, tenantId: 'tenant-1', actorId: 2,
  });
  assert.deepEqual(result, { consumidos: 1, faltantes: 1 });
  assert.equal(db.stock.get('item-1'), 0);
  const ledger = db.llamadas.find((q) => /INSERT INTO inventario_consumos_reserva/.test(q.sql));
  assert.deepEqual(ledger.params.slice(5), [3, 1, 2]);
});

test('does not consume a reservation item twice', async () => {
  const db = dbFalso({
    receta: [{ item_id: 'item-1', cantidad_solicitada: '2', stock_actual: '5', nombre: 'Tinte', unidad: 'ml' }],
    consumosPrevios: ['item-1'],
  });
  const result = await consumirInsumosDeReserva(db, {
    bookingId: 'booking-3', serviceId: 'service-1', salonId: 10, tenantId: 'tenant-1', actorId: 2,
  });
  assert.deepEqual(result, { consumidos: 0, faltantes: 0 });
  assert.equal(db.llamadas.some((q) => /UPDATE inventario_salon/.test(q.sql)), false);
});
