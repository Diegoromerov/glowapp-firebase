/**
 * El orquestador biométrico carga y expone `analyze`.
 *
 * El enganche de E5 vive dentro del análisis y no se puede ejercitar sin fotos ni
 * proveedores; lo que este test impide es el fallo más probable al añadirlo: una
 * ruta de require mal escrita, que tumba el análisis entero en producción.
 */
jest.mock('../src/config/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

test('el orquestador carga y expone analyze', () => {
  const orquestador = require('../src/services/biometric/orchestrator');
  expect(typeof orquestador.analyze).toBe('function');
});

test('el servicio de cuotas que usa el orquestador existe', () => {
  const cuotas = require('../src/services/cuotasService');
  expect(typeof cuotas.registrarConsumo).toBe('function');
});

test('las tarifas del paquete llegan al orquestador', () => {
  const { PUNTOS_LECTURA, COSTO_LECTURA_COP } = require('../src/config/cuotasIA');
  expect(PUNTOS_LECTURA.HD).toBe(12);
  expect(COSTO_LECTURA_COP.HD).toBe(1920);
});
