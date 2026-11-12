/**
 * GET /api/rewards/nivel — nivel y cuota de análisis con IA de la usuaria.
 *
 * Devuelve lo mismo que se pinta en la pantalla de niveles, para que el cliente
 * no tenga que recalcular reglas: el día que cambien los montos, cambian en un
 * solo sitio.
 */
const cuotasService = require('../services/cuotasService');

exports.nivel = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const estado = await cuotasService.estadoDelMes({ userId });
    res.json(estado);
  } catch (error) {
    console.error('❌ Error al calcular el nivel y la cuota:', error.message);
    res.status(500).json({ error: 'No pudimos calcular tu nivel' });
  }
};
