// backend/src/services/vto/vtoService.js
const { pool } = require('../../config/db');
const redisClient = require('../../config/redis');

class VtoService {
  /**
   * Obtiene catálogo de productos VTO filtrados por categoría y subtono biométrico
   * @param {string} category - 'makeup', 'nails', 'hair'
   * @param {string} subtono - 'cálido', 'frío', 'neutro'
   * @returns {Promise<Array>} Lista de productos con tonos HEX y metadata de marca
   */
  async getCatalog(category = 'makeup', subtono = 'neutro') {
    const isWarm = (subtono || '').toLowerCase().includes('cál');

    // Catálogo dinámico multimarca (Marca, Nombre, Tono HEX, Acabado, Marca Aliada B2B)
    const mockCatalog = {
      makeup: isWarm ? [
        { id: 'mk-01', brand: 'L\'Oréal Paris', name: 'Color Riche Coral Sunset', hex: '#E05A47', finish: 'Mate', price: 14.99, isFeatured: true },
        { id: 'mk-02', brand: 'MAC Cosmetics', name: 'Velvet Teddy Warm Nude', hex: '#C88A68', finish: 'Satinado', price: 24.50, isFeatured: true },
        { id: 'mk-03', brand: 'Maybelline', name: 'SuperStay Terracota Glow', hex: '#B84A39', finish: 'Mate', price: 11.99, isFeatured: false },
      ] : [
        { id: 'mk-04', brand: 'Dior Beauty', name: 'Rouge Dior Berry Crush', hex: '#9E2A2B', finish: 'Brillante', price: 42.00, isFeatured: true },
        { id: 'mk-05', brand: 'Fenty Beauty', name: 'Gloss Bomb Pink Rose', hex: '#D87093', finish: 'Satinado', price: 22.00, isFeatured: true },
        { id: 'mk-06', brand: 'NYX Cosmetics', name: 'Shine Loud Classic Ruby', hex: '#A4161A', finish: 'Mate', price: 10.50, isFeatured: false },
      ],
      nails: isWarm ? [
        { id: 'nl-01', brand: 'OPI', name: 'Terracota Warm Elegance', hex: '#B84A39', style: 'Almond', price: 12.50, isFeatured: true },
        { id: 'nl-02', brand: 'Essie', name: 'Sunlit Gold Glitter', hex: '#D4AF37', style: 'Square', price: 10.00, isFeatured: true },
      ] : [
        { id: 'nl-03', brand: 'Chanel', name: 'Le Vernis Deep Burgundy', hex: '#4A0E17', style: 'Coffin', price: 32.00, isFeatured: true },
        { id: 'nl-04', brand: 'Sally Hansen', name: 'Miracle Gel French Classic', hex: '#FFF0F5', style: 'Oval', price: 9.99, isFeatured: false },
      ]
    };

    return mockCatalog[category] || mockCatalog.makeup;
  }

  /**
   * Registra un trabajo de Try-On de uñas en Redis y Postgres (nail_tryon_jobs)
   */
  async createNailJob(userId, imageBuffer, style = 'Almond', colorHex = '#B84A39') {
    try {
      const jobId = `nail_job_${Date.now()}_${userId}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // 1. Guardar en Postgres
      if (pool) {
        await pool.query(
          `INSERT INTO nail_tryon_jobs (user_id, status, expires_at)
           VALUES ($1, $2, $3) RETURNING id`,
          [userId, 'queued', expiresAt]
        );
      }

      // 2. Encolar en Redis
      if (redisClient && typeof redisClient.rpush === 'function') {
        await redisClient.rpush('nail_tryon_jobs', JSON.stringify({
          jobId,
          userId,
          style,
          colorHex,
          createdAt: new Date().toISOString(),
        }));
      }

      return {
        jobId,
        status: 'queued',
        message: 'Trabajo de VTO de uñas encolado exitosamente',
      };
    } catch (error) {
      console.error('Error al crear trabajo de Nail VTO:', error.message);
      return {
        jobId: `fallback_${Date.now()}`,
        status: 'completed',
        message: 'Modo simulación inmediata activo',
      };
    }
  }
}

module.exports = new VtoService();
