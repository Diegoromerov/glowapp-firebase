const mockQuery = jest.fn();
const mockSendPush = jest.fn();

jest.mock('../src/config/db', () => ({ pool: { query: (...args) => mockQuery(...args) } }));
jest.mock('../src/services/fcmNotificationService', () => ({
  sendPushNotification: (...args) => mockSendPush(...args),
}));

const { sendPushToUser, sendPushToRole } = require('../src/services/pushNotificationService');

describe('pushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sends the user notification through FCM and reports real delivery', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 7, fcm_token: 'device-token', push_enabled: true }],
    });
    mockSendPush.mockResolvedValue({ success: true, messageId: 'fcm-message-id' });

    await expect(sendPushToUser(7, 'Título', 'Mensaje', { bookingId: 12 }))
      .resolves.toBe(true);
    expect(mockSendPush).toHaveBeenCalledWith('device-token', {
      title: 'Título',
      body: 'Mensaje',
      data: { bookingId: 12 },
    });
  });

  test('does not report simulated delivery as a successful push', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 7, fcm_token: 'device-token', push_enabled: true }],
    });
    mockSendPush.mockResolvedValue({ success: true, simulated: true });

    await expect(sendPushToUser(7, 'Título', 'Mensaje')).resolves.toBe(false);
  });

  test('counts only notifications accepted by FCM in role sends', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 7, fcm_token: 'device-token-1', push_enabled: true },
        { id: 8, fcm_token: 'device-token-2', push_enabled: true },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 7, fcm_token: 'device-token-1', push_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, fcm_token: 'device-token-2', push_enabled: true }] });
    mockSendPush
      .mockResolvedValueOnce({ success: true, messageId: 'fcm-message-id' })
      .mockResolvedValueOnce({ success: false, error: 'FCM rejected token' });

    await expect(sendPushToRole('CLIENTE', 'Título', 'Mensaje')).resolves.toBe(1);
  });
});
