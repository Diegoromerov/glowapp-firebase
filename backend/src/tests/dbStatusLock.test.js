const { clasificarSalud, decidirBloqueo } = require('../middleware/degradedLock');

describe('ORDEN A Ronda 6 — Clasificación de Salud y Candado de Degradación (Honestidad de DB)', () => {

  describe('clasificarSalud(dbStatus)', () => {

    test('Case 1: pgAvailable === null y servingFabricatedData === false -> status "UNKNOWN", httpStatus 200, degradado false', () => {
      const dbStatus = { pgAvailable: null, servingFabricatedData: false };
      const salud = clasificarSalud(dbStatus);

      expect(salud.status).toBe('UNKNOWN');
      expect(salud.httpStatus).toBe(200);
      expect(salud.degradado).toBe(false);
      expect(salud.message).toContain('sin comprobar');
    });

    test('Case 2: pgAvailable === true y servingFabricatedData === false -> status "OK", httpStatus 200, degradado false', () => {
      const dbStatus = { pgAvailable: true, servingFabricatedData: false };
      const salud = clasificarSalud(dbStatus);

      expect(salud.status).toBe('OK');
      expect(salud.httpStatus).toBe(200);
      expect(salud.degradado).toBe(false);
    });

    test('Case 3: pgAvailable === false o servingFabricatedData === true -> status "DEGRADED", httpStatus 503, degradado true', () => {
      const dbStatusFailed = { pgAvailable: false, servingFabricatedData: false };
      const saludFailed = clasificarSalud(dbStatusFailed);

      expect(saludFailed.status).toBe('DEGRADED');
      expect(saludFailed.httpStatus).toBe(503);
      expect(saludFailed.degradado).toBe(true);

      const dbStatusFabricated = { pgAvailable: true, servingFabricatedData: true };
      const saludFabricated = clasificarSalud(dbStatusFabricated);

      expect(saludFabricated.status).toBe('DEGRADED');
      expect(saludFabricated.httpStatus).toBe(503);
      expect(saludFabricated.degradado).toBe(true);
    });

  });

  describe('decidirBloqueo(dbStatus)', () => {

    test('Case 1: pgAvailable === null y servingFabricatedData === false -> shouldBlock: false, reason "UNCHECKED"', () => {
      const dbStatus = { pgAvailable: null, servingFabricatedData: false };
      const decision = decidirBloqueo(dbStatus);

      expect(decision.shouldBlock).toBe(false);
      expect(decision.reason).toBe('UNCHECKED');
    });

    test('Case 2: pgAvailable === true y servingFabricatedData === false -> shouldBlock: false, reason "HEALTHY"', () => {
      const dbStatus = { pgAvailable: true, servingFabricatedData: false };
      const decision = decidirBloqueo(dbStatus);

      expect(decision.shouldBlock).toBe(false);
      expect(decision.reason).toBe('HEALTHY');
    });

    test('Case 3: pgAvailable === false o servingFabricatedData === true -> shouldBlock: true, reason "DEGRADED_DB", httpStatus 503', () => {
      const dbStatusFailed = { pgAvailable: false, servingFabricatedData: false };
      const decisionFailed = decidirBloqueo(dbStatusFailed);

      expect(decisionFailed.shouldBlock).toBe(true);
      expect(decisionFailed.reason).toBe('DEGRADED_DB');
      expect(decisionFailed.httpStatus).toBe(503);

      const dbStatusFabricated = { pgAvailable: false, servingFabricatedData: true };
      const decisionFabricated = decidirBloqueo(dbStatusFabricated);

      expect(decisionFabricated.shouldBlock).toBe(true);
    });

  });

});
