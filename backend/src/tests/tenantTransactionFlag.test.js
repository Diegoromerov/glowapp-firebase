// backend/src/tests/tenantTransactionFlag.test.js
//
// Regresión del hallazgo P0 t_fix_tenant_06:
// "TENANT_TRANSACTION_PER_REQUEST flag=false = fuga cross-tenant".
//
// El aislamiento por inquilino NO puede depender de un opt-in que nadie
// enciende: con la variable ausente debe estar ACTIVO. Y, en producción, un
// despliegue no debe poder apagarlo en silencio (flag=false -> fuga
// cross-tenant): un control de aislamiento que un `.env` mal puesto puede
// desactivar no es un control.
//
// Prueba unitaria pura: no requiere base de datos ni levantar el middleware.

const tenantRouting = require('../config/tenantRouting');

const FLAG = 'TENANT_TRANSACTION_PER_REQUEST';

/** Ejecuta `fn` con NODE_ENV/flag fijados y restaura el entorno pase lo que pase. */
function conEntorno({ nodeEnv, flag }, fn) {
  const prevEnv = process.env.NODE_ENV;
  const prevFlag = process.env[FLAG];

  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;

  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;

  try {
    return fn();
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;

    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
  }
}

describe('tenantTransactionFlag — aislamiento por inquilino activo por defecto (P0 t_fix_tenant_06)', () => {
  test('variable AUSENTE => aislamiento ACTIVO (no puede ser opt-in)', () => {
    expect(
      conEntorno({ nodeEnv: 'test', flag: undefined }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(true);
  });

  test("valor 'true' => aislamiento ACTIVO", () => {
    expect(
      conEntorno({ nodeEnv: 'test', flag: 'true' }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(true);
  });

  test("cualquier valor distinto de 'false' => aislamiento ACTIVO (defensivo)", () => {
    for (const valor of ['0', 'no', 'off', '']) {
      expect(
        conEntorno({ nodeEnv: 'test', flag: valor }, () =>
          tenantRouting.isPerRequestTransactionEnabled()
        )
      ).toBe(true);
    }
  });

  test("desarrollo/test: 'false' desactiva (escotilla para comparar comportamientos)", () => {
    expect(
      conEntorno({ nodeEnv: 'test', flag: 'false' }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(false);
    expect(
      conEntorno({ nodeEnv: 'development', flag: 'false' }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(false);
  });

  test("producción: 'false' NO puede desactivar el aislamiento (cierra la fuga cross-tenant)", () => {
    expect(
      conEntorno({ nodeEnv: 'production', flag: 'false' }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(true);
  });

  test('producción: variable AUSENTE => aislamiento ACTIVO', () => {
    expect(
      conEntorno({ nodeEnv: 'production', flag: undefined }, () =>
        tenantRouting.isPerRequestTransactionEnabled()
      )
    ).toBe(true);
  });
});
