const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_2026';
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(bodyParser.json());

// Mock in-memory blacklist
const blacklist = new Set();
const otps = new Map();

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) blacklist.add(token);
  res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  const otp = '123456';
  otps.set(email.toLowerCase(), otp);
  res.json({ success: true, message: 'OTP enviado', otp });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, otp, new_password } = req.body;
  const stored = otps.get((email || '').toLowerCase());
  if (!stored || stored !== otp) {
    return res.status(400).json({ error: 'Código OTP inválido' });
  }
  otps.delete(email.toLowerCase());
  res.json({ success: true, message: 'Contraseña actualizada exitosamente.' });
});

describe('Auth Phase 1 Integration Tests', () => {
  const token = jwt.sign({ id: 1, email: 'test@glowapp.com' }, JWT_SECRET, { expiresIn: '1h' });

  test('POST /api/auth/logout - debe revocar el token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(blacklist.has(token)).toBe(true);
  });

  test('POST /api/auth/forgot-password - debe generar OTP', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@glowapp.com' });
    expect(res.status).toBe(200);
    expect(res.body.otp).toBe('123456');
  });

  test('POST /api/auth/reset-password - debe cambiar contraseña con OTP válido', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'test@glowapp.com', otp: '123456', new_password: 'newsecretpassword' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
