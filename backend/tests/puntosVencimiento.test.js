// Aviso de puntos por vencer (F2).
//
// El riesgo no es enviar de menos: es enviar el mismo aviso todos los días
// durante un mes. Por eso la marca por lote es parte del contrato, y si el envío
// falla NO se marca (se reintenta), mientras que si no hay token sí se marca
// (reintentar un aviso que no puede llegar es ruido).
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/fcmNotificationService', () => ({ sendPushNotification: jest.fn() }));

const { avisarVencimientoPuntos } = require('../src/jobs/puntosVencimiento');

function clienteFalso(pendientes = []) {
  return {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: pendientes }) // SELECT de lotes por avisar
      .mockResolvedValue({ rowCount: 1, rows: [] }), // UPDATE de marca
  };
}

describe('avisarVencimientoPuntos', () => {
  test('avisa una vez por lote y lo marca', async () => {
    const notificador = { sendPushNotification: jest.fn().mockResolvedValue({ ok: true }) };
    const cliente = clienteFalso([
      { id: 'lot-1', user_id: 7, puntos_restantes: 500, vence_en: '2026-12-10T00:00:00Z', fcm_token: 'tok-1' },
    ]);

    const r = await avisarVencimientoPuntos({ cliente, notificador });

    expect(r).toEqual({ revisados: 1, enviados: 1, sinToken: 0 });
    expect(notificador.sendPushNotification).toHaveBeenCalledTimes(1);
    const [token, payload] = notificador.sendPushNotification.mock.calls[0];
    expect(token).toBe('tok-1');
    expect(payload.body).toMatch(/500 puntos/);
    expect(payload.data).toMatchObject({ tipo: 'puntos_vencimiento', lote: 'lot-1' });

    const updates = cliente.query.mock.calls.filter(([sql]) => /UPDATE points_lots/.test(sql));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual(['lot-1']);
  });

  test('sin token no envía, pero marca el lote para no reintentar en vano', async () => {
    const notificador = { sendPushNotification: jest.fn() };
    const cliente = clienteFalso([
      { id: 'lot-2', user_id: 8, puntos_restantes: 100, vence_en: '2026-12-01T00:00:00Z', fcm_token: null },
    ]);

    const r = await avisarVencimientoPuntos({ cliente, notificador });

    expect(r).toEqual({ revisados: 1, enviados: 0, sinToken: 1 });
    expect(notificador.sendPushNotification).not.toHaveBeenCalled();
    expect(cliente.query.mock.calls.some(([sql]) => /UPDATE points_lots/.test(sql))).toBe(true);
  });

  test('si el envío falla no marca el lote: se reintenta en la próxima pasada', async () => {
    const notificador = {
      sendPushNotification: jest.fn().mockRejectedValue(new Error('token inválido')),
    };
    const cliente = clienteFalso([
      { id: 'lot-3', user_id: 9, puntos_restantes: 500, vence_en: '2026-12-05T00:00:00Z', fcm_token: 'tok-3' },
    ]);

    const r = await avisarVencimientoPuntos({ cliente, notificador });

    expect(r).toMatchObject({ revisados: 1, enviados: 0 });
    expect(cliente.query.mock.calls.some(([sql]) => /UPDATE points_lots/.test(sql))).toBe(false);
  });

  test('sin lotes por vencer no hace nada', async () => {
    const notificador = { sendPushNotification: jest.fn() };
    const cliente = clienteFalso([]);

    const r = await avisarVencimientoPuntos({ cliente, notificador });

    expect(r).toEqual({ revisados: 0, enviados: 0, sinToken: 0 });
    expect(cliente.query).toHaveBeenCalledTimes(1);
  });
});
