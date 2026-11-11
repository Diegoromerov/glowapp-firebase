// backend/tests/referralService.test.js
// Atribución y conversión del programa de referidos.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));

const { atribuirInvitacion, registrarConversion } = require('../src/services/referralService');

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
    expect(sql).toMatch(/referred_by_user_id IS NULL/);
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

describe('registrarConversion', () => {
  beforeEach(() => jest.clearAllMocks());

  test('un invitado sin referidor no genera conversión', async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: null }] }),
    };

    expect(await registrarConversion({ inviteeId: 9, pool })).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('el primer servicio del invitado registra la conversión una sola vez', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'conv-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const ok = await registrarConversion({ inviteeId: 9, bookingId: 'b-1', pool });

    expect(ok).toBe(true);
    const [insertSql, insertParams] = pool.query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO referral_conversions/);
    expect(insertSql).toMatch(/ON CONFLICT \(invitee_user_id\) DO NOTHING/);
    expect(insertParams).toEqual([7, 9, 'b-1']);
    expect(pool.query.mock.calls[2][0]).toMatch(/referral_converted_at = NOW\(\)/);
  });

  test('la segunda reserva no vuelve a contar', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ referred_by_user_id: 7 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    expect(await registrarConversion({ inviteeId: 9, pool })).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});
