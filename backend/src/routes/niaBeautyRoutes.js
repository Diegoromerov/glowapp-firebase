const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { processBiometricScan } = require('../services/aiOrchestrator');
const pool = require('../config/db'); // Asumiendo que tienes tu config de PG aquí
const { authMiddleware } = require('../middleware/auth');
const biometricConsentGuard = require('../middleware/biometricConsentGuard');

router.post('/scan', authMiddleware, biometricConsentGuard, async (req, res) => {
  try {
    const { image_base64 } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: 'Se requiere una imagen para el análisis.' });
    }

    // 1. Llamar al Worker de Python
    const biometricData = await processBiometricScan(image_base64);

    // 2. Guardar resultados en PostgreSQL (Tabla: user_biometrics)
    // Nota: Asegúrate de crear esta tabla en tu DB si no existe
    const query = `
      INSERT INTO user_biometrics (user_id, subtono, estacion, paleta, hidratacion, sebo, mensaje_aura)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    
    const values = [
      req.user.id,
      biometricData.subtono,
      biometricData.estacion,
      JSON.stringify(biometricData.paleta),
      biometricData.hidratacion,
      biometricData.sebo,
      biometricData.mensaje_aura
    ];

    const result = await pool.query(query, values);

    // 3. Retornar éxito a Flutter
    res.status(200).json({
      message: 'Análisis completado exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    if (error.code === 'BIOMETRIC_ANALYSIS_UNAVAILABLE' || error.statusCode === 503) {
      return res.status(503).json({ error: 'AI_UNAVAILABLE', message: 'El análisis no está disponible en este momento.' });
    }
    res.status(500).json({ error: error.message });
  }
});

wrapRouterAsync(router);
module.exports = router;
