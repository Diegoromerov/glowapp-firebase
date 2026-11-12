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

  test('la compra del invitado acredita 500 puntos a su fondo', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'conv-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const r = await acreditarCompraReferida({ inviteeId: 9, orderId: 'o-1', pool });

    expect(r).toEqual({ acreditado: true, puntos: 500, referidorId: 7 });

    const [convSql, convParams] = pool.query.mock.calls[1];
    expect(convSql).toMatch(/INSERT INTO referral_conversions/);
    expect(convSql).toMatch(/ON CONFLICT \(invitee_user_id\) DO NOTHING/);
    expect(convParams).toEqual([7, 9, 'o-1', 500]);

    // Los puntos van al invitado (a quien el mensaje le promete el beneficio),
    // y NO a Wompi.
    const [xpSql, xpParams] = pool.query.mock.calls[2];
    expect(xpSql).toMatch(/INSERT INTO xp_logs/);
    expect(xpParams).toEqual([9, 500, 'referido:compra']);
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
});
