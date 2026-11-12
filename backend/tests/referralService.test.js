// Atribución y premio del programa de referidos.
//
// Regla del Director (2026-11-11): $5.000 COP en puntos —no Wompi— y sólo
// cuando el invitado hace una compra efectiva de productos; no por recomendar ni
// por reservar.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const {
  atribuirInvitacion,
  acreditarCompraReferida,
  PUNTOS_POR_COMPRA_REFERIDA,
} = require('../src/services/referralService');

describe('atribuirInvitacion', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normaliza el código y no deja que alguien se invite a sí mismo', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };

    const ok = await atribuirInvitacion({
      nuevoUsuarioId: 42,
      codigo: '  glowab12 ',
      pool,
    });

    expect(ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE usuarios u/);
    expect(sql).toMatch(/r\.id <> u\.id/);
    expect(params).toEqual([42, 'GLOWAB12']);
  });

  test('un código inexistente no rompe el registro', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    await expect(
      atribuirInvitacion({ nuevoUsuarioId: 42, codigo: 'NOEXISTE', pool })
    ).resolves.toBe(false);
  });

  test('sin código no consulta la base', async () => {
    const pool = { query: jest.fn() };
    expect(await atribuirInvitacion({ nuevoUsuarioId: 42, codigo: '', pool })).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('acreditarCompraReferida', () => {
  beforeEach(() => jest.clearAllMocks());

  test('el premio son 500 puntos ($5.000 COP con la regla del canje)', () => {
    expect(PUNTOS_POR_COMPRA_REFERIDA).toBe(500);
  });

  test('un invitado sin referidor no recibe nada', async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: null }] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-1', pool });

    expect(r.acreditado).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('la compra del invitado acredita un lote de 500 al referente y 100 de bienvenida al invitado', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'conv-1', estado: 'ACREDITADA' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'lot-ref' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'lot-inv' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-1', pool });

    expect(r).toEqual({ acreditado: true, puntos: 500, referidorId: 7 });

    const [convSql, convParams] = pool.query.mock.calls[1];
    expect(convSql).toMatch(/INSERT INTO referral_conversions/);
    expect(convSql).toMatch(/ON CONFLICT \(invitee_user_id\) DO NOTHING/);
    // El tope mensual va dentro del INSERT: el 5.º parámetro son los 10 premios y
    // el 6.º la marca antifraude (aquí `false`: la invitada no comparte huella).
    expect(convParams).toEqual([7, 9, 'o-1', 500, 10, false]);
    expect(convSql).toMatch(/TOPE_MENSUAL/);

    // Los puntos van al libro de puntos canjeables, NO a xp_logs: el XP de nivel
    // quedó separado del dinero (migración 142).
    const [lotSql, lotParams] = pool.query.mock.calls[2];
    expect(lotSql).toMatch(/INSERT INTO points_lots/);
    expect(lotSql).not.toMatch(/xp_logs/);
    expect(lotParams).toEqual([7, 500, 'referido:compra', 'o-1', 'Premio por la compra de tu invitada', null]);

    // Doble lado (D-02): el invitado recibe 100 puntos una sola vez.
    const [bienSql, bienParams] = pool.query.mock.calls[3];
    expect(bienSql).toMatch(/INSERT INTO points_lots/);
    expect(bienParams[0]).toBe(9);
    expect(bienParams[1]).toBe(100);
    expect(bienParams[2]).toBe('referido:bienvenida');
  });

  test('una segunda compra del mismo invitado no vuelve a acreditar', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-2', pool });

    expect(r.acreditado).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('si la invitada comparte IP con quien la invita, queda en revisión y no cobra', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              referred_by_user_id: 7,
              invitee_ip: 'hash-igual',
              invitee_device: null,
              referrer_ip: 'hash-igual',
              referrer_device: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'conv-x', estado: 'EN_REVISION', points_awarded: 0 }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-x', pool });

    expect(r).toMatchObject({ acreditado: false, puntos: 0, motivo: 'EN_REVISION' });
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO points_lots/.test(String(sql)))).toBe(
      false
    );
  });

  test('una compra por debajo del mínimo no convierte ni gasta la conversión', async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ referred_by_user_id: 7 }],
      }),
    };

    const r = await acreditarCompraReferida({
      inviteeId: 9,
      orderId: 'o-barato',
      totalProductos: 18000,
      pool,
    });

    expect(r).toMatchObject({ acreditado: false, motivo: 'COMPRA_BAJO_MINIMO' });
    // Solo se consultó al referidor: no hay conversión registrada, así que la
    // invitada puede convertir más adelante con una compra que sí califique.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('la conversión que supera el tope mensual se registra sin puntos', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'conv-11', estado: 'TOPE_MENSUAL', points_awarded: 0 }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-11', pool });

    expect(r).toMatchObject({ acreditado: false, puntos: 0, motivo: 'TOPE_MENSUAL' });
    // No se crea lote: sin premio no hay nada que acreditar.
    const creoLote = pool.query.mock.calls.some(([sql]) =>
      /INSERT INTO points_lots/.test(String(sql))
    );
    expect(creoLote).toBe(false);
  });

  test('si la acreditación falla, se deshace la conversión para poder reintentar', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'conv-1' }] })
        // El lote del referente falla: la base rechaza la inserción.
        .mockRejectedValueOnce(new Error('insert or update on table "points_lots" violates check'))
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-1', pool });

    expect(r.acreditado).toBe(false);
    const [limpiezaSql, limpiezaParams] = pool.query.mock.calls[3];
    expect(limpiezaSql).toMatch(/DELETE FROM referral_conversions/);
    expect(limpiezaParams).toEqual(['conv-1']);
  });
});
