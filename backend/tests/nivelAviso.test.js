/**
 * Aviso de subida de nivel: una vez, con lo que se desbloquea, sin romper nada.
 */
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/fcmNotificationService', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/services/email.service', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

const { pool } = require('../src/config/db');
const fcm = require('../src/services/fcmNotificationService');
const emailService = require('../src/services/email.service');
const { avisarNivel } = require('../src/services/xpService');
const { nivelDeXp } = require('../src/config/cuotasIA');

const usuario = (extra = {}) => ({
  rows: [{ nombre: 'Ana', email: 'ana@x.co', fcm_token: 'tok-1', ultimo_nivel_notificado: null, ...extra }],
});

beforeEach(() => jest.clearAllMocks());

test('avisa por push y por correo, y deja la marca', async () => {
  pool.query.mockResolvedValueOnce(usuario()).mockResolvedValueOnce({ rowCount: 1 });
  const ok = await avisarNivel({ userId: 7, nivel: nivelDeXp(350) });

  expect(ok).toBe(true);
  expect(fcm.sendPushNotification).toHaveBeenCalledTimes(1);
  expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  const push = fcm.sendPushNotification.mock.calls[0][1];
  expect(push.title).toContain('Pétalo');
  expect(push.body).toContain('análisis');
  expect(pool.query.mock.calls[1][1]).toEqual(['petalo', 7]);
});

test('no repite el aviso del mismo nivel', async () => {
  pool.query.mockResolvedValueOnce(usuario({ ultimo_nivel_notificado: 'petalo' }));
  const ok = await avisarNivel({ userId: 7, nivel: nivelDeXp(350) });
  expect(ok).toBe(false);
  expect(fcm.sendPushNotification).not.toHaveBeenCalled();
});

test('sin token ni correo no rompe: sólo deja la marca', async () => {
  pool.query
    .mockResolvedValueOnce(usuario({ fcm_token: null, email: null }))
    .mockResolvedValueOnce({ rowCount: 1 });
  const ok = await avisarNivel({ userId: 7, nivel: nivelDeXp(1000) });
  expect(ok).toBe(true);
  expect(fcm.sendPushNotification).not.toHaveBeenCalled();
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

test('si el push falla, el correo sale igual', async () => {
  fcm.sendPushNotification.mockRejectedValueOnce(new Error('sin token'));
  pool.query.mockResolvedValueOnce(usuario()).mockResolvedValueOnce({ rowCount: 1 });
  const ok = await avisarNivel({ userId: 7, nivel: nivelDeXp(2500) });
  expect(ok).toBe(true);
  expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
});
