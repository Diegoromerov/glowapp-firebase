const express = require('express');
const request = require('supertest');
const portfolioRoutes = require('../routes/portfolioRoutes');

describe('Portfolio API Routes (/api/portfolio)', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Mock user in auth middleware or bypass
    app.use('/api/portfolio', (req, res, next) => {
      req.user = { id: 101, role: 'provider' };
      next();
    }, portfolioRoutes);
  });

  it('should validate POST /api/portfolio with image_url without returning 400 Joi validation error', async () => {
    const res = await request(app)
      .post('/api/portfolio')
      .send({
        image_url: 'https://images.unsplash.com/photo-1562322140-8baeececf3df',
        title: 'Balayage Cenizo Premium',
        category: 'hair'
      });

    // Should NOT be 400 Joi error ("image_url" is not allowed)
    expect(res.status).not.toBe(400);
  });
});
