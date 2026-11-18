/**
 * Cotizacion de envio por zonas (L5).
 *
 * El caso que lo motivo: el pedido guardo `ciudad: "bogota"` (sin tilde) y la zona del
 * catalogo se llama "Bogotá". Con `lower()` en SQL no coincidian, caia al fallback
 * global "OTRO" y se cobraban 15.400 en vez de 9.000 por un envio a Bogota.
 */

jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/db');
const { cotizarEnvio } = require('../src/services/shippingService');

const zona = (over) => ({
  codigo_postal_prefijo: null,
  tarifa_por_kg: '400.00',
  gratis_desde_monto: null,
  transportadora_default: 'Servientrega',
  dias_estimados_min: 1,
  dias_estimados_max: 3,
  activa: true,
  ...over
});

const BOGOTA = zona({
  ciudad: 'Bogotá',
  departamento: 'Bogotá D.C.',
  codigo_postal_prefijo: '11',
  tarifa_base: '9000.00',
  gratis_desde_monto: '120000.00'
});

const BOGOTA_SUR = zona({
  ciudad: 'Bogotá',
  departamento: 'Bogotá D.C.',
  codigo_postal_prefijo: '110',
  tarifa_base: '8000.00'
});

const MEDELLIN = zona({
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  codigo_postal_prefijo: '05',
  tarifa_base: '10000.00',
  transportadora_default: 'Inter Rapidísimo'
});

const OTRO = zona({
  ciudad: 'OTRO',
  departamento: 'Nacional',
  tarifa_base: '15400.00',
  tarifa_por_kg: '500.00',
  transportadora_default: 'Coordinadora',
  dias_estimados_min: 3,
  dias_estimados_max: 6
});

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockReset();
  pool.query.mockImplementation((sql) => {
    if (/FROM municipios_dane/i.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [BOGOTA, BOGOTA_SUR, MEDELLIN, OTRO] });
  });
});

describe('cotizarEnvio — emparejamiento tolerante', () => {
  test('ciudad sin tilde ni mayusculas cobra la tarifa de su ciudad, no la de OTRO', async () => {
    const r = await cotizarEnvio({ ciudad: 'bogota', departamento: 'Bogotá D.C.' });

    expect(r.zona).toBe('Bogotá, Bogotá D.C.');
    expect(r.costo).toBe(9200); // 9000 + 400 * 0.5 kg
    expect(r.transportadora).toBe('Servientrega');
  });

  test('tolera tildes ausentes tambien en el departamento', async () => {
    const r = await cotizarEnvio({ ciudad: 'BOGOTA', departamento: 'BOGOTA D.C.' });
    expect(r.zona).toBe('Bogotá, Bogotá D.C.');
    expect(r.costo).toBe(9200);
  });

  test('ciudad con tilde y catalogo sin tilde tambien coincide', async () => {
    pool.query.mockResolvedValue({
      rows: [zona({ ciudad: 'Medellin', departamento: 'Antioquia', tarifa_base: '10000.00' })]
    });
    const r = await cotizarEnvio({ ciudad: 'Medellín', departamento: 'Antioquia' });
    expect(r.zona).toBe('Medellin, Antioquia');
    expect(r.costo).toBe(10200);
  });

  test('con codigo postal gana el prefijo mas especifico', async () => {
    const conCp = await cotizarEnvio({
      ciudad: 'bogota',
      departamento: 'Bogotá D.C.',
      codigo_postal: '110111'
    });
    expect(conCp.tarifa_base).toBe(8000);

    const sinCp = await cotizarEnvio({ ciudad: 'bogota', departamento: 'Bogotá D.C.' });
    expect(sinCp.tarifa_base).toBe(9000);
  });

  test('envio gratis cuando el pedido supera el monto de la zona', async () => {
    const r = await cotizarEnvio({
      ciudad: 'bogota',
      departamento: 'Bogotá D.C.',
      valor_pedido: 150000
    });
    expect(r.gratis).toBe(true);
    expect(r.costo).toBe(0);
  });

  test('ciudad fuera del catalogo usa OTRO (y lo dice)', async () => {
    const r = await cotizarEnvio({ ciudad: 'Leticia', departamento: 'Amazonas' });
    expect(r.zona).toBe('OTRO, Nacional');
    expect(r.costo).toBe(15650); // 15400 + 500 * 0.5
    expect(r.transportadora).toBe('Coordinadora');
  });

  test('resuelve primero el municipio DANE y compara zonas sin depender de lower() en SQL', async () => {
    await cotizarEnvio({ ciudad: 'bogota', departamento: 'Bogotá D.C.' });
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toMatch(/FROM municipios_dane/i);
    const sql = pool.query.mock.calls[1][0];
    expect(sql).not.toMatch(/lower\(/i);
  });

  test('usa zona vinculada al municipio DANE cuando el nombre de la zona difiere', async () => {
    const zonaDane = zona({ id: 'zona-dane', ciudad: 'Municipio normalizado', departamento: 'Departamento', tarifa_base: '7000.00' });
    pool.query.mockImplementation((sql) => {
      if (/FROM municipios_dane/i.test(sql)) {
        return Promise.resolve({ rows: [{ dane_code: '05001', nombre: 'Medellín', departamento_nombre: 'Antioquia', zona_envio_id: 'zona-dane' }] });
      }
      return Promise.resolve({ rows: [zonaDane, OTRO] });
    });

    const result = await cotizarEnvio({ ciudad: 'medellin', departamento: 'Antioquia' });
    expect(result.zona).toBe('Municipio normalizado, Departamento');
    expect(result.costo).toBe(7200);
  });

  test('sin ciudad o departamento falla con mensaje propio', async () => {
    await expect(cotizarEnvio({ ciudad: '', departamento: 'Bogotá D.C.' })).rejects.toThrow(
      /ciudad y departamento son obligatorios/
    );
  });
});
