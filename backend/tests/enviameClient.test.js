const crypto = require('crypto');
const { EnviameClient } = require('../src/services/enviameClient');

describe('EnviameClient — DIVIPOLA, routing y modo seguro', () => {
  const municipio = {
    dane_code: '05001',
    nombre: 'MEDELLÍN',
    departamento_codigo: '05',
    departamento_nombre: 'ANTIOQUIA',
    zona_envio_id: 'zona-medellin'
  };

  test('resuelve municipio por nombre normalizado y rechaza una dirección fuera de DIVIPOLA', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [municipio] }) };
    const client = new EnviameClient({ pool });

    const result = await client.validateAddress({ city: 'Medellin', state: 'Antioquia', street: 'Calle 1' });
    expect(result).toMatchObject({ valid: true, dane_code: '05001', state: '05' });
    expect(pool.query.mock.calls[0][1]).toEqual(['Medellin', 'medellin', '', 'antioquia']);

    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(client.locateColombiaCity('Ciudad inventada', '05')).rejects.toThrow(/DIVIPOLA/);
  });

  test('sin base de datos no inventa códigos DANE en modo mock', async () => {
    const client = new EnviameClient();
    const result = await client.validateAddress({ city: 'Bogotá', state: '11', street: 'Calle 1' });
    expect(result).toMatchObject({ valid: false, reason: 'Catálogo DIVIPOLA no disponible' });
    await expect(client.locateColombiaCity('Bogotá', '11')).rejects.toThrow(/Catálogo DIVIPOLA/);
  });

  test('aplica reglas en orden de prioridad, peso y valor; no agrega carriers ficticios', async () => {
    const rules = [
      { carrier: 'inter', carrier_service_code: 'inter_express', carrier_account_id: 'acct-1', prioridad: 1,
        peso_min_kg: '0', peso_max_kg: '2', valor_min_cop: '0', valor_max_cop: '500000', dias_maximos_entrega: 2 },
      { carrier: 'tcc', carrier_service_code: 'tcc_estandar', carrier_account_id: 'acct-2', prioridad: 2,
        peso_min_kg: '0', peso_max_kg: '10', valor_min_cop: '0', valor_max_cop: '1000000', dias_maximos_entrega: 4 }
    ];
    const pool = { query: jest.fn(async (sql) => {
      if (/FROM municipios_dane/i.test(sql)) return { rows: [municipio] };
      if (/FROM shipping_routing_rules/i.test(sql)) return { rows: rules };
      return { rows: [] };
    }) };
    const client = new EnviameClient({ pool });
    const rates = await client.getRates({
      origin: { city: '11001' },
      destination: { city: 'Medellin', state: 'Antioquia' },
      parcels: [{ weight: 1.5 }],
      value_cop: 300000
    });

    expect(rates.map((rate) => rate.carrier)).toEqual(['inter', 'tcc']);
    expect(rates[0]).toMatchObject({ rate_id: 'mock-inter-inter_express-1', prioridad: 1, days_max: 2 });
    expect(rates).toHaveLength(2);

    const filteredRates = await client.getRates({
      origin: { city: '11001' },
      destination: { city: 'Medellin', state: 'Antioquia' },
      parcels: [{ weight_kg: 3 }],
      value_cop: 700000
    });
    expect(filteredRates.map((rate) => rate.carrier)).toEqual(['tcc']);
  });

  test('una ruta sin reglas usa el fallback OTRO definido en base de datos', async () => {
    const calls = [];
    const pool = { query: jest.fn(async (sql) => {
      calls.push(sql);
      if (/FROM municipios_dane/i.test(sql)) return { rows: [municipio] };
      if (/SELECT id FROM zonas_envio/i.test(sql)) return { rows: [{ id: 'zona-otro' }] };
      if (/FROM shipping_routing_rules/i.test(sql)) {
        return calls.filter((query) => /FROM shipping_routing_rules/i.test(query)).length === 1
          ? { rows: [] }
          : { rows: [{ carrier: 'envia', carrier_service_code: 'envia_estandar', carrier_account_id: 'mock-acct', prioridad: 1,
            peso_min_kg: 0, peso_max_kg: 50, valor_min_cop: 0, valor_max_cop: null, dias_maximos_entrega: 5 }] };
      }
      return { rows: [] };
    }) };
    const rates = await new EnviameClient({ pool }).getRates({
      origin: { city: '11001' }, destination: { city: '05001' }, parcels: [{ weight_kg: 1 }], value_cop: 10000
    });

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ carrier: 'envia', prioridad: 1 });
  });

  test('etiqueta y recogida mock conservan carrier y servicio seleccionados', async () => {
    const client = new EnviameClient();
    const label = await client.generateLabel({
      rate_id: 'mock-tcc-tcc_estandar-1',
      metadata: { carrier: 'tcc', service_code: 'tcc_estandar', carrier_account_id: 'acct-tcc' }
    });
    const pickup = await client.schedulePickup({
      tracking_number: label.tracking_number,
      pickup_address: { city: '05001' },
      pickup_window_start: '2026-12-01T09:00:00Z',
      pickup_window_end: '2026-12-01T12:00:00Z',
      contact_name: 'Proveedor', contact_phone: '3000000000', carrier: label.carrier
    });

    expect(label).toMatchObject({ carrier: 'tcc', service_code: 'tcc_estandar', carrier_account_id: 'acct-tcc' });
    expect(pickup).toMatchObject({ carrier: 'tcc', status: 'scheduled' });
  });

  test('modo productivo falla cerrado sin credenciales o firma webhook', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiKey = process.env.ENVIAME_API_KEY;
    delete process.env.ENVIAME_API_KEY;
    process.env.NODE_ENV = 'production';
    try {
      const client = new EnviameClient();
      expect(client._mockMode).toBe(false);
      expect(client.verifyWebhook('{}', '')).toBe(false);
      await expect(client._fetch('/ship/generate')).rejects.toThrow(/ENVIAME_API_KEY/);

      const configuredClient = new EnviameClient({ apiKey: 'sandbox-key' });
      await expect(configuredClient.getRates({
        origin: { city: '11001' },
        destination: { city: '11001' },
        parcels: [{ weight: 1 }],
        value_cop: 10000
      })).rejects.toThrow(/cotización real.*no está habilitada/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiKey === undefined) delete process.env.ENVIAME_API_KEY;
      else process.env.ENVIAME_API_KEY = previousApiKey;
    }
  });

  test('valida HMAC en modo de credencial real y rechaza firma alterada', () => {
    const payload = '{"event":"shipment.delivered"}';
    const secret = 'sandbox-secret';
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const client = new EnviameClient({ apiKey: 'sandbox-key', webhookSecret: secret });

    expect(client.verifyWebhook(payload, signature)).toBe(true);
    expect(client.verifyWebhook(payload, 'bad-signature')).toBe(false);
  });
});
