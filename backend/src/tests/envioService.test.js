// Pruebas del cálculo de envío del checkout de tienda (D-GL-011 v2 / D-GL-015).
//
// Usan un cliente pg falso: no tocan ninguna base de datos. Las tarifas y
// umbrales son los que hoy tienen las filas de `zonas_envio` en producción,
// leídas con railway ssh el 2026-10-18:
//   Bogotá   | base 9.000  | 400/kg | gratis desde 300.000 | Servientrega
//   Medellín | base 10.000 | 500/kg | gratis desde 480.000 | Inter Rapidísimo
//   OTRO     | base 15.000 | 800/kg | gratis desde 480.000 | Coordinadora

const { calcularEnvio, RETENCION_ENVIO } = require('../services/envioService');

const ZONAS = [
  {
    ciudad: 'Bogotá',
    departamento: 'Bogotá D.C.',
    codigo_postal_prefijo: '11',
    tarifa_base: '9000.00',
    tarifa_por_kg: '400.00',
    gratis_desde_monto: '300000.00',
    transportadora_default: 'Servientrega',
    activa: true
  },
  {
    ciudad: 'Medellín',
    departamento: 'Antioquia',
    codigo_postal_prefijo: '05',
    tarifa_base: '10000.00',
    tarifa_por_kg: '500.00',
    gratis_desde_monto: '480000.00',
    transportadora_default: 'Inter Rapidísimo',
    activa: true
  },
  {
    ciudad: 'OTRO',
    departamento: 'Nacional',
    codigo_postal_prefijo: null,
    tarifa_base: '15000.00',
    tarifa_por_kg: '800.00',
    gratis_desde_monto: '480000.00',
    transportadora_default: 'Coordinadora',
    activa: true
  }
];

const clienteFalso = () => ({ query: jest.fn().mockResolvedValue({ rows: ZONAS }) });

describe('envioService.calcularEnvio', () => {
  test('Bogotá, 1 unidad de 30.000 → tarifa 9.200 + retención 1.000 = envío 10.200', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      ciudad: 'Bogotá',
      direccion: 'Calle 100 #15-20',
      subtotal: 30000,
      unidades: 1
    });

    expect(r.zona).toBe('Bogotá');
    expect(r.transportadora).toBe('Servientrega');
    expect(r.peso_kg).toBe(0.5);
    expect(r.tarifa_operador).toBe(9200);
    expect(r.retencion).toBe(RETENCION_ENVIO);
    expect(r.envio).toBe(10200);
    expect(r.gratis).toBe(false);
    expect(r.motivo).toBe('ciudad_declarada');
  });

  test('Bogotá, subtotal 300.000 → envío 0 (umbral de zona)', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      ciudad: 'Bogotá',
      direccion: 'Calle 100 #15-20',
      subtotal: 300000,
      unidades: 1
    });

    expect(r.envio).toBe(0);
    expect(r.gratis).toBe(true);
    expect(r.retencion).toBe(0);
    expect(r.motivo).toBe('umbral_de_zona_alcanzado');
  });

  test('Medellín, 3 unidades (1,5 kg) y subtotal 479.999 → 10.000 + 500×1,5 + 1.000 = 11.750', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      ciudad: 'Medellín',
      direccion: 'Carrera 43 #1-50',
      subtotal: 479999,
      unidades: 3
    });

    expect(r.zona).toBe('Medellín');
    expect(r.peso_kg).toBe(1.5);
    expect(r.tarifa_operador).toBe(10750);
    expect(r.retencion).toBe(1000);
    expect(r.envio).toBe(11750);
    expect(r.gratis).toBe(false);
  });

  test('Medellín, subtotal 480.000 → envío 0 (umbral de zona)', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      ciudad: 'Medellín',
      direccion: 'Carrera 43 #1-50',
      subtotal: 480000,
      unidades: 3
    });

    expect(r.envio).toBe(0);
    expect(r.gratis).toBe(true);
  });

  test('Dirección "Calle 45 #12-30, Medellín" sin ciudad → zona Medellín', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      direccion: 'Calle 45 #12-30, Medellín',
      subtotal: 30000,
      unidades: 1
    });

    expect(r.zona).toBe('Medellín');
    expect(r.motivo).toBe('ciudad_inferida_de_la_direccion');
  });

  test('Dirección irreconocible sin ciudad → zona comodín OTRO', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      direccion: 'Km 4 vía veredal, finca La Esperanza',
      subtotal: 30000,
      unidades: 1
    });

    expect(r.zona).toBe('OTRO');
    expect(r.motivo).toBe('zona_comodin');
    expect(r.envio).toBe(16400); // 15.000 + 800×0,5 + 1.000
  });

  test('Entrega en la cita → envío 0 sin consultar zonas', async () => {
    const client = clienteFalso();
    const r = await calcularEnvio({
      client,
      ciudad: 'Bogotá',
      direccion: 'Calle 100 #15-20',
      subtotal: 30000,
      unidades: 1,
      entregaEnCita: true
    });

    expect(r.envio).toBe(0);
    expect(r.retencion).toBe(0);
    expect(r.gratis).toBe(false);
    expect(r.motivo).toBe('entrega_en_cita');
    expect(client.query).not.toHaveBeenCalled();
  });
});
