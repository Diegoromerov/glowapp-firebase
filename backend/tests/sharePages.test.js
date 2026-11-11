// backend/tests/sharePages.test.js
// GET /s/provider/:id — la página que convierte un enlace en una tarjeta con
// imagen en WhatsApp/Instagram, y que además redirige a la app.
jest.mock('../src/config/db', () => ({ pool: { query: jest.fn() } }));
// La ruta consulta con contexto de sistema (RLS); en la prueba se delega al pool
// mockeado para no montar una conexión.
jest.mock('../src/config/tenantRouting', () => ({
  runAsSystem: (_pool, fn) => fn({ query: (...args) => require('../src/config/db').pool.query(...args) }),
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/db');
const sharePagesRoutes = require('../src/routes/sharePagesRoutes');

const app = express();
app.use('/s', sharePagesRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const prestador = {
  id: 3,
  nombre: 'Carla Makeup Studio',
  description: 'Maquillaje social, novias y pestañas. Prueba de maquillaje previa.',
  rating_avg: '5.0',
  rating_count: 17,
  foto_url: 'https://storage.googleapis.com/glowapp-client.firebasestorage.app/carla.jpg',
};

describe('GET /s/provider/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('devuelve HTML con las etiquetas que leen las redes', async () => {
    pool.query.mockResolvedValueOnce({ rows: [prestador] });

    const res = await request(app).get('/s/provider/3');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('Carla Makeup Studio');
    expect(res.text).toContain('5.0★');
    expect(res.text).toContain('17 opiniones');
    // Sin imagen no hay tarjeta: es el punto del cambio.
    expect(res.text).toMatch(/og:image" content="https:\/\/storage\.googleapis\.com/);
    expect(res.text).toContain('og:url" content="https://glowapp-client.web.app/provider-detail/3"');
    // Y el que no siga la redirección tiene un enlace utilizable.
    expect(res.text).toContain('http-equiv="refresh"');
    expect(res.text).toContain('Abrir en GlowApp');
    expect(res.headers['cache-control']).toMatch(/max-age=300/);
  });

  test('un prestador inexistente responde 404 en HTML, no en JSON', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/s/provider/999999');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('ya no está disponible');
  });

  test('un id no numérico responde 400 sin consultar la base', async () => {
    const res = await request(app).get('/s/provider/abc');

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('si la base falla la página igual se muestra, en 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('conexión caída'));

    const res = await request(app).get('/s/provider/3');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Intenta de nuevo');
  });

  test('escapa el nombre del prestador (no inyecta HTML)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ ...prestador, nombre: 'Carla <script>alert(1)</script>' }],
    });

    const res = await request(app).get('/s/provider/3');

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('GET /s/product/:id', () => {
  const producto = {
    id: 7,
    nombre: 'Sérum Vitamina C',
    descripcion: 'Ilumina y unifica el tono. 30 ml.',
    imagen_url: 'https://storage.googleapis.com/glowapp-client.firebasestorage.app/serum.jpg',
  };

  beforeEach(() => jest.clearAllMocks());

  test('devuelve la tarjeta del producto con imagen', async () => {
    pool.query.mockResolvedValueOnce({ rows: [producto] });

    const res = await request(app).get('/s/product/7');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Sérum Vitamina C');
    expect(res.text).toMatch(/og:image" content="https:\/\/storage\.googleapis\.com/);
    expect(res.text).toContain('og:url" content="https://glowapp-client.web.app/s/product/7"');
    expect(res.text).toContain('http-equiv="refresh"');
  });

  test('producto inexistente responde 404 en HTML', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/s/product/999');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});
