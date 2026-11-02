/**
 * FASE C · t_fix_backend_04 — P0 «Montos float vs centavos integer»
 * Hallazgo citado: backend/src/routes/paymentRoutes.js (bloque de retenciones/«confirm-otp»)
 *   «Los montos se calculan y suman en float; el redondeo a centavos se hace
 *    por resta de floats → deriva (p. ej. 100.10 - 5.31 = 94.78999999999999).»
 *
 * Contrato que este test fija:
 *   1. Existe un módulo de dinero `backend/src/utils/money.js` que opera en CENTAVOS ENTEROS
 *      (compatibles con COP, 2 decimales).
 *   2. `toCents` convierte de pesos (string numérico o número) a centavos enteros con
 *      redondeo half-up al centavo, SIN heredar la deriva binaria del float.
 *   3. `fromCents` es el inverso exacto de `toCents` para valores de 2 decimales.
 *   4. `pctOf` y `calcularRetenciones` producen SIEMPRE centavos enteros y su suma es
 *      exacta (sin `...0000000000001`).
 *   5. La ruta paymentRoutes.js usa `money.js` para las retenciones y el neto del prestador
 *      y NO conserva el cálculo/redondeo por float.
 *
 * ESTE TEST ES ROJO ANTES DEL FIX: `utils/money.js` no existe y la ruta conserva el float.
 *
 * Test estático/hermético: no requiere `npm install` ni base de datos. Corre bajo Jest
 * (transform desactivado, CommonJS nativo) y también con `node`.
 */
const fs = require('fs');
const path = require('path');

const RUTA_MONEY = path.join(__dirname, '..', 'utils', 'money.js');
const RUTA_RUTA = path.join(__dirname, '..', 'routes', 'paymentRoutes.js');

// Require perezoso: si el módulo no existe (ROJO), cada test falla individualmente
// en lugar de tumbar la carga de toda la suite.
function cargarMoney() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(RUTA_MONEY);
}

function fuenteRuta() {
  return fs.readFileSync(RUTA_RUTA, 'utf8');
}

describe('FASE C · t_fix_backend_04 — Montos float vs centavos enteros (paymentRoutes)', () => {
  describe('1. money.toCents — conversión exacta a centavos enteros', () => {
    test('convierte strings de la BD (numeric) a centavos sin deriva binaria', () => {
      const money = cargarMoney();
      expect(money.toCents('100.10')).toBe(10010);
      expect(money.toCents('95.54')).toBe(9554);
      expect(money.toCents('0.01')).toBe(1);
      expect(money.toCents('0')).toBe(0);
      expect(money.toCents('50000')).toBe(5000000);
    });

    test('convierte números a centavos enteros', () => {
      const money = cargarMoney();
      expect(money.toCents(100.1)).toBe(10010);
      expect(money.toCents(10.1)).toBe(1010);
      expect(money.toCents(4500)).toBe(450000);
    });

    test('redondea half-up al centavo (tercer decimal)', () => {
      const money = cargarMoney();
      expect(money.toCents('10.994')).toBe(1099);
      expect(money.toCents('10.995')).toBe(1100);
      expect(money.toCents('0.004')).toBe(0);
      expect(money.toCents('0.005')).toBe(1);
    });

    test('nunca devuelve un valor fraccionario: siempre entero', () => {
      const money = cargarMoney();
      for (const v of ['100.10', '250.70', 83.33, 7.77, '0.414']) {
        expect(Number.isInteger(money.toCents(v))).toBe(true);
      }
    });

    test('rechaza montos no numéricos', () => {
      const money = cargarMoney();
      expect(() => money.toCents('abc')).toThrow();
      expect(() => money.toCents(NaN)).toThrow();
    });
  });

  describe('2. money.fromCents — inverso exacto', () => {
    test('reconstruye el valor decimal de 2 cifras', () => {
      const money = cargarMoney();
      expect(money.fromCents(10010)).toBe(100.1);
      expect(money.fromCents(9554)).toBeCloseTo(95.54, 10);
      expect(money.fromCents(1)).toBe(0.01);
      expect(money.fromCents(0)).toBe(0);
    });

    test('rechaza centavos fraccionarios', () => {
      const money = cargarMoney();
      expect(() => money.fromCents(1.5)).toThrow();
    });
  });

  describe('3. money.pctOf — porcentaje sobre centavos enteros', () => {
    test('calcula retenciones como enteros exactos', () => {
      const money = cargarMoney();
      // 100.10 * 4.0%  = 4.004  -> 400 centavos
      expect(money.pctOf(10010, 4.0)).toBe(400);
      // 100.10 * 0.414% = 0.41442 -> 41 centavos
      expect(money.pctOf(10010, 0.414)).toBe(41);
      // 6.00 * 15% = 0.90 -> 90 centavos
      expect(money.pctOf(600, 15.0)).toBe(90);
    });

    test('siempre enteros', () => {
      const money = cargarMoney();
      expect(Number.isInteger(money.pctOf(10010, 4.0))).toBe(true);
      expect(Number.isInteger(money.pctOf(10010, 0.414))).toBe(true);
    });
  });

  describe('4. money.calcularRetenciones — sin deriva float', () => {
    test('caso 100.10 / comisión 6.00: neto exacto 94.79 (float daría 94.78999999999999)', () => {
      const money = cargarMoney();
      const r = money.calcularRetenciones({
        basePagoNetoCents: money.toCents('100.10'),
        comisionPlataformaCents: money.toCents('6.00'),
        retefuentePct: 4.0,
        reteicaPct: 0.414,
        reteivaPct: 15.0
      });

      expect(r.retencionFuenteCents).toBe(400);
      expect(r.retencionIcaCents).toBe(41);
      expect(r.retencionIvaCents).toBe(90);
      expect(r.totalRetencionesCents).toBe(531);
      expect(r.montoNetoCents).toBe(9479);
      expect(money.fromCents(r.montoNetoCents)).toBeCloseTo(94.79, 10);

      // El defecto exacto que este fix elimina:
      const floatNeto = 100.1 - (4.0 + 0.41 + 0.9);
      expect(floatNeto).not.toBe(94.79);
      expect(Number.isInteger(r.montoNetoCents)).toBe(true);
    });

    test('caso 250.70 / comisión 15.30: neto exacto 237.33 (float daría 237.32999999999998)', () => {
      const money = cargarMoney();
      const r = money.calcularRetenciones({
        basePagoNetoCents: money.toCents('250.70'),
        comisionPlataformaCents: money.toCents('15.30'),
        retefuentePct: 4.0,
        reteicaPct: 0.414,
        reteivaPct: 15.0
      });

      expect(r.totalRetencionesCents).toBe(1337);
      expect(r.montoNetoCents).toBe(23733);
      expect(money.fromCents(r.montoNetoCents)).toBeCloseTo(237.33, 10);

      const floatNeto = 250.7 - (10.03 + 1.04 + 2.3);
      expect(floatNeto).not.toBe(237.33);
    });

    test('todos los campos devueltos son centavos enteros', () => {
      const money = cargarMoney();
      const r = money.calcularRetenciones({
        basePagoNetoCents: money.toCents('83.33'),
        comisionPlataformaCents: money.toCents('5.00'),
        retefuentePct: 4.0,
        reteicaPct: 0.414,
        reteivaPct: 15.0
      });
      for (const v of Object.values(r)) {
        expect(Number.isInteger(v)).toBe(true);
      }
    });
  });

  describe('5. paymentRoutes.js usa money.js y no el cálculo flotante', () => {
    test('importa ../utils/money', () => {
      const fuente = fuenteRuta();
      expect(fuente).toMatch(/require\(\s*['"]\.\.\/utils\/money['"]\s*\)/);
    });

    test('D-GL-023: no aplica retenciones al prestador (retefuente, reteICA y reteIVA eliminadas)', () => {
      const fuente = fuenteRuta();
      expect(fuente).not.toMatch(/calcularRetenciones\s*\(/);
      expect(fuente).toMatch(/retencionFuente\s*=\s*0/);
      expect(fuente).toMatch(/retencionIva\s*=\s*0/);
    });

    test('elimina el redondeo flotante Math.round(x * 100) / 100 de las retenciones', () => {
      const fuente = fuenteRuta();
      expect(fuente).not.toMatch(/Math\.round\([^;]*\*\s*100\s*\)\s*\/\s*100/);
    });

    test('elimina la suma flotante totalRetenciones = retencionFuente + retencionIca + retencionIva', () => {
      const fuente = fuenteRuta();
      expect(fuente).not.toMatch(/totalRetenciones\s*=\s*retencionFuente\s*\+\s*retencionIca\s*\+\s*retencionIva/);
    });

    test('elimina parseFloat directo de pago_neto_prestador / comision_plataforma en la liquidación', () => {
      const fuente = fuenteRuta();
      expect(fuente).not.toMatch(/const\s+basePagoNeto\s*=\s*parseFloat\(/);
      expect(fuente).not.toMatch(/const\s+comisionPlataforma\s*=\s*parseFloat\(/);
    });
  });
});
