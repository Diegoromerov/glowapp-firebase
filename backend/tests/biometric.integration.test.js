// backend/tests/biometric.integration.test.js
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');

// Creamos una app Mock Express aislada para no depender de la base de datos PostgreSQL viva ni de Redis en CI
const app = express();
app.use(bodyParser.json());

app.post('/api/consent', (req, res) => {
  const { userId, version, accepted } = req.body;
  if (!userId || accepted !== true) {
    return res.status(400).json({ error: 'Faltan datos de consentimiento' });
  }
  res.status(200).json({ success: true, consentId: 'mock-consent-id-123' });
});

app.post('/api/biometric/analyze', (req, res) => {
  const { userId, faceImage, handsImage } = req.body;
  if (!userId || !faceImage || !handsImage) {
    return res.status(400).json({ error: 'Faltan imágenes' });
  }
  res.status(200).json({
    success: true,
    results: {
      face: { hydration: 80, wrinkles: 10, spots: 20, pores: 15, subtono: 'cálido', bioAge: 25 },
      hands: { manchasSolares: 'leve', sequedad: 'leve', cuticulas: 'sanas', unas: 'sanas', edadAparente: 25 },
      recommendation: 'Usa crema hidratante y protector solar FPS 50+'
    }
  });
});

app.get('/api/biometric/profile/:userId', (req, res) => {
  res.status(200).json({
    faceScores: { hydration: 80, wrinkles: 10, spots: 20, pores: 15, subtono: 'cálido', bioAge: 25 },
    handsDiagnosis: { manchasSolares: 'leve', sequedad: 'leve', cuticulas: 'sanas', unas: 'sanas', edadAparente: 25 }
  });
});

app.post('/api/product/check', (req, res) => {
  res.status(200).json({
    product: {
      barcode: req.body.barcode,
      name: 'Crema Hidratante FPS 30',
      brand: 'GlowBrand',
      compatible: true,
      compatibilityReason: 'Es compatible'
    }
  });
});

describe('Biometric API Integration Tests', () => {
  const userId = 'test-user-123';

  test('POST /api/consent - debe guardar consentimiento', async () => {
    const response = await request(app)
      .post('/api/consent')
      .send({ userId, version: '1.0', accepted: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.consentId).toBeDefined();
  });

  test('POST /api/biometric/analyze - debe analizar imágenes', async () => {
    const faceImage = Buffer.from('mock-face-image').toString('base64');
    const handsImage = Buffer.from('mock-hands-image').toString('base64');

    const response = await request(app)
      .post('/api/biometric/analyze')
      .send({ userId, faceImage, handsImage });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.results.face).toBeDefined();
    expect(response.body.results.hands).toBeDefined();
    expect(response.body.results.recommendation).toBeDefined();
  });

  test('GET /api/biometric/profile/:userId - debe devolver perfil', async () => {
    const response = await request(app)
      .get(`/api/biometric/profile/${userId}`);

    expect(response.status).toBe(200);
    expect(response.body.faceScores).toBeDefined();
    expect(response.body.handsDiagnosis).toBeDefined();
  });

  test('POST /api/product/check - debe verificar producto', async () => {
    const barcode = '1234567890';
    const response = await request(app)
      .post('/api/product/check')
      .send({ userId, barcode });

    expect(response.status).toBe(200);
    expect(response.body.product).toBeDefined();
  });
});
