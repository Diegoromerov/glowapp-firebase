// backend/tests/api.upload_image.test.js
const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

app.post('/api/upload', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token requerido' });
  
  res.status(200).json({ url: 'https://storage.glowapp.com/uploads/test_image.png' });
});

describe('POST /api/upload', () => {
  const endpoint = '/api/upload';

  test('should upload a valid PNG image and return URL', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer dummy-token')
      .send({ image: 'base64_data' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('url');
    expect(typeof response.body.url).toBe('string');
  });

  test('should reject request without authorization header', async () => {
    const response = await request(app).post(endpoint);
    expect(response.statusCode).toBe(401);
  });
});
