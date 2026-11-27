const test = require('node:test');
const assert = require('node:assert/strict');
const { crearControladorCaja } = require('../controllers/cajaController');

function respuesta() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function solicitud(plan, tipo) {
  return {
    salonPlan: plan,
    salonId: 7,
    salonMembership: { sub_rol: 'DUEÑO' },
    user: { id: 99 },
    body: {
      tipo,
      concepto: tipo === 'GASTO' ? 'INSUMO' : 'SERVICIO',
      monto: 25000,
      metodo_pago: 'EFECTIVO',
      idempotency_key: `caja-${plan}-${tipo}`,
    },
  };
}

test('Freemium rejects cash expenses before writing and preserves internal income receipts', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT bp.tenant_id')) return { rows: [{ tenant_id: 'tenant-7' }] };
      if (sql.includes('INSERT INTO caja_movimientos')) {
        return { rows: [{ id: 1, tipo: 'INGRESO', monto: '25000', constancia_ref: 'CJ-7-test' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const controller = crearControladorCaja(db);

  const rejected = respuesta();
  await controller.registrar(solicitud('FREEMIUM', 'GASTO'), rejected);
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.body.code, 'FULL_CASH_REGISTER_REQUIRED');
  assert.equal(calls.length, 0, 'a rejected expense must not query or mutate the database');

  const receipt = respuesta();
  await controller.registrar(solicitud('FREEMIUM', 'INGRESO'), receipt);
  assert.equal(receipt.statusCode, 201);
  assert.equal(receipt.body.movimiento.tipo, 'INGRESO');
  assert.equal(calls.filter((sql) => sql.includes('INSERT INTO caja_movimientos')).length, 1);
});

test('cash summary tells the provider when Freemium is in receipt-only mode', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('COUNT(*)::int AS movimientos')) {
        return { rows: [{ ingresos: '0', gastos: '0', movimientos: 0 }] };
      }
      if (sql.includes('GROUP BY tipo, concepto')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const controller = crearControladorCaja(db);
  const req = {
    salonPlan: 'FREEMIUM',
    salonId: 7,
    salonMembership: { sub_rol: 'DUEÑO' },
    user: { id: 99 },
    query: {},
  };
  const res = respuesta();
  await controller.resumen(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.modo_registro, 'CONSTANCIAS_INGRESO');
});

test('plans with full cash register retain expense recording', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT bp.tenant_id')) return { rows: [{ tenant_id: 'tenant-7' }] };
      if (sql.includes('INSERT INTO caja_movimientos')) {
        return { rows: [{ id: 2, tipo: 'GASTO', monto: '25000', constancia_ref: 'CJ-7-test' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const controller = crearControladorCaja(db);
  const res = respuesta();
  await controller.registrar(solicitud('BASIC', 'GASTO'), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.movimiento.tipo, 'GASTO');
});
