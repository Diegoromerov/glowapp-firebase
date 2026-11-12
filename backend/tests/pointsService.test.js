// Libro de puntos: el dinero del programa, separado del XP de estado.
//
// Reglas que este archivo protege (R-00, R-02, R-10 del documento de
// arquitectura):
//   - un premio nace con vencimiento a 12 meses y acredita una sola vez;
//   - el saldo no cuenta lo vencido ni lo comprometido en un pedido;
//   - el consumo es FEFO: primero el lote que vence antes;
//   - nunca queda un lote con puntos negativos.
//
// El servicio recibe el cliente/pool por parámetro para poder probar el SQL sin
// levantar Postgres; la prueba de comportamiento real vive en
// pointsLedger.integration.test.js.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const pointsService = require('../src/services/pointsService');

const {
  acreditar,
  saldo,
  comprometer,
  consumir,
  liberar,
  revertir,
  MESES_VIGENCIA,
  VALOR_PUNTO_COP,
  BLOQUE_CANJE,
} = pointsService;

describe('constantes del programa', () => {
  test('1 punto = $10 y el canje va en bloques de 100', () => {
    expect(VALOR_PUNTO_COP).toBe(10);
    expect(BLOQUE_CANJE).toBe(100);
  });

  test('los puntos vencen a los 12 meses', () => {
    expect(MESES_VIGENCIA).toBe(12);
  });
});

describe('acreditar', () => {
  test('crea el lote con vencimiento a 12 meses y es idempotente por origen+referencia', async () => {
    const cliente = {
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'lot-1' }] }),
    };

    const r = await acreditar({
      userId: 7,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: 'o-1',
      motivo: 'Premio por compra de tu invitada',
      cliente,
    });

    expect(r).toEqual({ acreditado: true, lotId: 'lot-1' });

    const [sql, params] = cliente.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO points_lots/);
    expect(sql).toMatch(/INTERVAL '12 months'/);
    expect(sql).toMatch(/ON CONFLICT \(origen, referencia_id\)/);
    expect(sql).toMatch(/DO NOTHING/);
    expect(params).toEqual([
      7,
      500,
      'referido:compra',
      'o-1',
      'Premio por compra de tu invitada',
      null,
    ]);
  });

  test('si el lote ya existe no acredita dos veces', async () => {
    const cliente = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };

    const r = await acreditar({
      userId: 7,
      puntos: 500,
      origen: 'referido:compra',
      referenciaId: 'o-1',
      cliente,
    });

    expect(r).toEqual({ acreditado: false, lotId: null });
  });

  test('rechaza puntos que no son un entero positivo', async () => {
    const cliente = { query: jest.fn() };

    await expect(
      acreditar({ userId: 7, puntos: 0, origen: 'referido:compra', cliente })
    ).rejects.toMatchObject({ code: 'PUNTOS_INVALIDOS' });

    await expect(
      acreditar({ userId: 7, puntos: 1.5, origen: 'referido:compra', cliente })
    ).rejects.toMatchObject({ code: 'PUNTOS_INVALIDOS' });

    expect(cliente.query).not.toHaveBeenCalled();
  });

  test('rechaza una acreditación sin origen ni usuario', async () => {
    const cliente = { query: jest.fn() };

    await expect(acreditar({ userId: 7, puntos: 500, cliente })).rejects.toMatchObject({
      code: 'ACREDITACION_INVALIDA',
    });
    await expect(
      acreditar({ puntos: 500, origen: 'referido:compra', cliente })
    ).rejects.toMatchObject({ code: 'ACREDITACION_INVALIDA' });
    expect(cliente.query).not.toHaveBeenCalled();
  });
});

describe('saldo', () => {
  test('suma sólo lotes vigentes y separa lo que está en espera', async () => {
    const cliente = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ saldo: '1200', por_vencer: '500' }] })
        .mockResolvedValueOnce({ rows: [{ en_espera: '300' }] }),
    };

    const r = await saldo({ userId: 7, cliente });

    expect(r).toEqual({ saldo: 1200, porVencer: 500, enEspera: 300 });

    const [sqlSaldo, paramsSaldo] = cliente.query.mock.calls[0];
    expect(sqlSaldo).toMatch(/FROM points_lots/);
    expect(sqlSaldo).toMatch(/vence_en > NOW\(\)/);
    expect(paramsSaldo).toEqual([7]);

    // "En espera" son compromisos sin consumo ni liberación: el saldo ya los
    // descontó, así que se informa aparte y nunca se suma.
    const [sqlEspera] = cliente.query.mock.calls[1];
    expect(sqlEspera).toMatch(/tipo = 'compromiso'/);
    expect(sqlEspera).toMatch(/NOT EXISTS/);
  });

  test('una usuaria sin puntos devuelve cero, no un error', async () => {
    const cliente = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ saldo: '0', por_vencer: '0' }] })
        .mockResolvedValueOnce({ rows: [{ en_espera: '0' }] }),
    };

    await expect(saldo({ userId: 7, cliente })).resolves.toEqual({
      saldo: 0,
      porVencer: 0,
      enEspera: 0,
    });
  });
});

describe('comprometer', () => {
  test('consume primero el lote que vence antes (FEFO) y deja el desglose', async () => {
    const cliente = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { id: 'lot-a', puntos_restantes: 300, vence_en: '2026-12-01' },
            { id: 'lot-b', puntos_restantes: 500, vence_en: '2027-06-01' },
          ],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] }),
    };

    const r = await comprometer({ userId: 7, pedidoId: 'p-1', puntos: 500, cliente });

    expect(r.aplicado).toBe(500);
    expect(r.desglose).toEqual([
      { lotId: 'lot-a', puntos: 300 },
      { lotId: 'lot-b', puntos: 200 },
    ]);

    const [sqlSelect] = cliente.query.mock.calls[0];
    expect(sqlSelect).toMatch(/FROM points_lots/);
    expect(sqlSelect).toMatch(/ORDER BY vence_en ASC/);
    expect(sqlSelect).toMatch(/FOR UPDATE/);

    const [sqlMov, paramsMov] = cliente.query.mock.calls[1];
    expect(sqlMov).toMatch(/INSERT INTO points_movements/);
    expect(paramsMov).toContain('canje:p-1:compromiso:lot-a');

    const [sqlUpdate, paramsUpdate] = cliente.query.mock.calls[2];
    expect(sqlUpdate).toMatch(/UPDATE points_lots/);
    expect(sqlUpdate).toMatch(/puntos_restantes >= \$1/);
    expect(paramsUpdate).toEqual([300, 'lot-a']);
  });

  test('con saldo insuficiente no escribe nada y dice cuánto hay', async () => {
    const cliente = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'lot-a', puntos_restantes: 100, vence_en: '2026-12-01' }],
      }),
    };

    await expect(
      comprometer({ userId: 7, pedidoId: 'p-1', puntos: 500, cliente })
    ).rejects.toMatchObject({ code: 'SALDO_INSUFICIENTE', disponible: 100 });

    expect(cliente.query).toHaveBeenCalledTimes(1);
  });

  test('sólo acepta bloques de 100 puntos', async () => {
    const cliente = { query: jest.fn() };

    await expect(
      comprometer({ userId: 7, pedidoId: 'p-1', puntos: 150, cliente })
    ).rejects.toMatchObject({ code: 'BLOQUE_INVALIDO' });

    expect(cliente.query).not.toHaveBeenCalled();
  });

  test('exige un pedido: no se comprometen puntos al aire', async () => {
    const cliente = { query: jest.fn() };

    await expect(comprometer({ userId: 7, puntos: 100, cliente })).rejects.toMatchObject({
      code: 'PEDIDO_REQUERIDO',
    });
  });
});

describe('consumir', () => {
  test('marca los compromisos del pedido como consumo, sin mover saldo', async () => {
    const cliente = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };

    const r = await consumir({ pedidoId: 'p-1', cliente });

    expect(r).toEqual({ consumidos: 1 });

    const [sql, params] = cliente.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO points_movements/);
    expect(sql).toMatch(/'consumo'/);
    expect(sql).toMatch(/ON CONFLICT \(clave\) DO NOTHING/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(params).toEqual(['p-1']);
  });
});

describe('liberar', () => {
  test('devuelve al lote lo comprometido y deja el rastro de liberación', async () => {
    const cliente = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'mov-1', lot_id: 'lot-a', user_id: 7, puntos: 300 }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] }),
    };

    const r = await liberar({ pedidoId: 'p-1', cliente });

    expect(r).toEqual({ liberados: 300 });

    const [sqlInsert, paramsInsert] = cliente.query.mock.calls[1];
    expect(sqlInsert).toMatch(/'liberacion'/);
    expect(paramsInsert).toContain('canje:p-1:liberacion:lot-a');

    const [sqlUpdate, paramsUpdate] = cliente.query.mock.calls[2];
    expect(sqlUpdate).toMatch(/UPDATE points_lots/);
    // El reingreso nunca supera el tamaño original del lote.
    expect(sqlUpdate).toMatch(/LEAST/);
    expect(paramsUpdate).toEqual([300, 'lot-a']);
  });

  test('un pedido sin compromisos no libera nada', async () => {
    const cliente = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(liberar({ pedidoId: 'p-1', cliente })).resolves.toEqual({ liberados: 0 });
    expect(cliente.query).toHaveBeenCalledTimes(1);
  });
});

describe('revertir', () => {
  test('devuelve sólo lo que queda sin gastar del lote de origen', async () => {
    const cliente = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'lot-a', puntos_restantes: 100 }] })
        .mockResolvedValue({ rowCount: 1, rows: [] }),
    };

    const r = await revertir({
      origen: 'referido:compra',
      referenciaId: 'o-1',
      puntos: 500,
      cliente,
    });

    expect(r).toEqual({ revertido: 100, noCubierto: 400 });
  });

  test('sin reembolsos previos falla limpio en vez de inventar un lote', async () => {
    const cliente = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(
      revertir({ origen: 'referido:compra', referenciaId: 'o-x', cliente })
    ).rejects.toMatchObject({ code: 'LOTE_NO_ENCONTRADO' });
  });
});
