/**
 * backend/tests/payment.money.cents.test.js
 *
 * P0 DINERO — hallazgo t_fix_pagos_06:
 *   `paymentRoutes.js` calculaba las retenciones de dispersión (retefuente, reteica,
 *   reteiva) y el monto neto del prestador con aritmética de punto flotante
 *   (`parseFloat(...)`, `Math.round(x*100)/100`). El error de representación de los
 *   dobles hace que un redondeo "de medio centavo" caiga hacia abajo:
 *
 *     IVA = 15% de una comisión de 1.50
 *       float : 1.5 * 0.15 * 100 = 22.499999999999996 -> Math.round = 22  -> 0.22
 *       exacto: 150 centavos * 15 / 100 = 22.5            -> half-up    = 23  -> 0.23
 *
 *   Un centavo por servicio, siempre a favor del sistema, sobre cada dispersión.
 *
 * Este test ejerce el handler real POST /bookings/:id/confirm-otp contra el arnés
 * pg-mem y comprueba el MONTO PERSISTIDO en centavos enteros. Falla (rojo) mientras
 * el cálculo siga en float y pasa (verde) cuando se hace en centavos enteros.
 *
 * DOS REGLAS DEL ARNÉS QUE ESTE TEST RESPETA (ver src/config/pgMemory.js):
 *
 *  1. No re-declarar lo que el arnés ya declara. `provider_wallet`,
 *     `wallet_transactions` y `pedidos_tienda` ya existen con los TIPOS de sus
 *     migraciones. Un `CREATE TABLE IF NOT EXISTS` local con otra forma NO es un
 *     no-op silencioso en pg-mem: el planner procesa el AST y aborta con
 *     "Not supported ... parts have not been read" por las constraints no leídas.
 *  2. Los tipos importan. Antes este test declaraba `wallet_transactions.metadata`
 *     como TEXT y `bookings.id` como VARCHAR(36); el arnés documenta que un tipo
 *     distinto "hace que el emulador mienta" y produce verdes en falso. Aquí se
 *     usan los tipos reales: `metadata JSONB` y `booking_id UUID`.
 *
 * Los `booking_id` son UUID REALES: `bookings.id` es `uuid` (modelo Booking +
 * migración 001), así que una cadena tipo `bk_cents_700` es un cast inválido.
 */
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { pool } = require('../src/config/db');
const paymentRoutes = require('../src/routes/paymentRoutes');

const CODIGO = '123456';

/** UUID determinista y válido a partir de un entero, para no inventar ids por caso. */
const uuidDe = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Solo lo que el arnés pg-mem NO declara. Tipos copiados de
// backend/migrations/001_payment_system.sql.
const SETUP_SQL = [
  `CREATE TABLE IF NOT EXISTS platform_config (
     key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL,
     descripcion TEXT, updated_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS otp_validaciones (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(), booking_id UUID NOT NULL UNIQUE,
     codigo_hash VARCHAR(255) NOT NULL, generado_at TIMESTAMP DEFAULT NOW(),
     expira_at TIMESTAMP NOT NULL, usado_at TIMESTAMP,
     intentos_fallidos INTEGER NOT NULL DEFAULT 0,
     estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO', ip_generacion VARCHAR(45))`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id SERIAL PRIMARY KEY, actor_id INTEGER, accion VARCHAR(50), tabla VARCHAR(50),
     registro_id VARCHAR(36), datos_antes JSONB, datos_despues JSONB, ip VARCHAR(45),
     created_at TIMESTAMP DEFAULT NOW())`,
];

// `base` es el pago_neto_prestador que deja el trigger de comisión.
// D-GL-023: no hay retenciones (retefuente, reteICA y reteIVA se eliminaron), así
// que `esperado` es exactamente la base. Lo que este test protege —que el monto se
// persista en centavos enteros, sin deriva de float— sigue igual de válido.
const CASOS = [
  { caso: 'base con centavos (10.00)', providerId: 700, base: 10.00, comision: 1.50, esperado: 10.00 },
  { caso: 'base con medio centavo (12.50)', providerId: 701, base: 12.50, comision: 1.50, esperado: 12.50 },
  { caso: 'comisión 4.10', providerId: 702, base: 20.50, comision: 4.10, esperado: 20.50 },
  { caso: 'comisión 3.30', providerId: 703, base: 21.97, comision: 3.30, esperado: 21.97 },
  { caso: 'control exacto (sin deriva de float)', providerId: 704, base: 100.00, comision: 20.00, esperado: 100.00 },
  { caso: 'control monto grande', providerId: 705, base: 33333.33, comision: 6666.67, esperado: 33333.33 },
];

function construirApp(clientId) {
  const app = express();
  app.use(bodyParser.json());
  // authMiddleware retorna next() si req.user ya está seteado: saltamos el JWT.
  app.use((req, res, next) => {
    req.user = { id: clientId, email: 'cliente.cents@glow.test', rol: 'CLIENTE' };
    next();
  });
  app.use('/api/payments', paymentRoutes);
  return app;
}

async function confirmar({ base, comision, providerId, clientId }) {
  const bookingId = uuidDe(providerId);
  const hash = await bcrypt.hash(CODIGO, 10);

  await pool.query(
    `INSERT INTO bookings (id, client_id, provider_id, service_id, valor_bruto,
                           comision_plataforma, pago_neto_prestador, estado)
     VALUES ($1, $2, $3, 'svc-money', $4, $5, $6, 'ESPERANDO_OTP')`,
    [bookingId, clientId, providerId, Number(base) + Number(comision), comision, base]
  );
  await pool.query(
    `INSERT INTO otp_validaciones (booking_id, codigo_hash, estado, expira_at, intentos_fallidos)
     VALUES ($1, $2, 'ACTIVO', NOW() + INTERVAL '45 minutes', 0)`,
    [bookingId, hash]
  );

  const res = await request(construirApp(clientId))
    .post(`/api/payments/bookings/${bookingId}/confirm-otp`)
    .send({ codigo: CODIGO });

  const wallet = await pool.query(
    'SELECT saldo_pendiente, total_ganado FROM provider_wallet WHERE provider_id = $1',
    [providerId]
  );
  const tx = await pool.query(
    `SELECT monto FROM wallet_transactions
     WHERE booking_id = $1 AND tipo = 'CREDITO_SERVICIO'`,
    [bookingId]
  );

  return { res, wallet: wallet.rows[0], tx: tx.rows[0] };
}

describe('P0 dinero — dispersión en centavos enteros (confirm-otp)', () => {
  beforeAll(async () => {
    for (const sql of SETUP_SQL) {
      await pool.query(sql);
    }
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20)');
  });

  test.each(CASOS)('$caso: neto exacto en centavos', async ({ caso, providerId, base, comision, esperado }) => {
    const clientId = 5;
    const { res, wallet, tx } = await confirmar({ base, comision, providerId, clientId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // El monto devuelto, el saldo y la transacción deben coincidir con el
    // resultado exacto en centavos (sin centavo perdido por float).
    expect(res.body.monto_neto_prestador).toBe(esperado);
    expect(Number(wallet.saldo_pendiente)).toBe(esperado);
    expect(Number(tx.monto)).toBe(esperado);

    // Todo monto persistido debe ser un valor exacto de 2 decimales.
    const centavos = Number(tx.monto) * 100;
    expect(Math.abs(centavos - Math.round(centavos))).toBeLessThan(1e-6);
  });

  test('un centavo no se pierde: el neto es exactamente la base (caso 10.00 / 1.50)', async () => {
      const { res } = await confirmar({ base: 10.00, comision: 1.50, providerId: 799, clientId: 5 });

      // Sin retenciones: el prestador recibe los 10.00 completos, en centavos exactos.
      expect(res.body.monto_neto_prestador).toBe(10.00);
      // Cualquier deriva de float habría dejado 9.99 o 10.01.
      expect(res.body.monto_neto_prestador).not.toBe(9.99);
    });

  test('utilidad money: aritmética de centavos sin deriva de float', () => {
    // La utilidad solo existe tras el fix; el require va dentro del test para que
    // el rojo de las pruebas de arriba sea por el bug y no por el import.
    const money = require('../src/utils/money');

    expect(money.aCentavos('1.50')).toBe(150);
    expect(money.aCentavos(10.00)).toBe(1000);
    expect(money.aCentavos(null)).toBe(0);
    expect(money.aCentavos('')).toBe(0);

    // 22.5 centavos -> 23 (half-up), no 22 como con float
    expect(money.porcentajeCentavos(150, 15.0)).toBe(23);
    expect(money.porcentajeCentavos(1000, 0.414)).toBe(4);
    expect(money.porcentajeCentavos(1000, 4.0)).toBe(40);

    const r = money.aplicarRetencionesCentavos({
      baseCentavos: 1000, comisionCentavos: 150,
      pctFuente: 4.0, pctIca: 0.414, pctIva: 15.0,
    });
    expect(r.fuenteCentavos).toBe(40);
    expect(r.icaCentavos).toBe(4);
    expect(r.ivaCentavos).toBe(23);
    expect(r.totalCentavos).toBe(67);
    expect(r.netoCentavos).toBe(933);
    expect(money.aDecimal(933)).toBe(9.33);
  });
});
