/**
 * Función pura para calcular proyecciones financieras en base al historial real de reservas completadas.
 * 
 * Reglas de Honestidad Operativa (ORDEN A-02):
 * 1. Si hay menos de 3 meses reales con datos (0, 1 o 2 meses):
 *    - data_status es 'insuficiente'
 *    - projectedRevenue es null (NUNCA inventar un valor ni simular tendencias con Math.random)
 *    - projectedMonth es null
 *    - trend es 'INSUFICIENTE'
 *    - history conserva los meses reales existentes (o [] si no hay datos).
 * 2. Si hay 3 o más meses reales con datos (≥3 meses):
 *    - data_status es 'completo'
 *    - projectedRevenue se calcula mediante regresión lineal no negativa
 *    - projectedMonth es el mes siguiente formateado (YYYY-MM)
 *    - trend es 'CRECIENTE' (slope >= 0) o 'DECRECIENTE' (slope < 0)
 * 
 * @param {Array<{month: string, revenue: number}>} realHistory Historial mensual real obtenido de la base de datos
 * @param {Date} now Instancia de fecha actual para determinar el mes proyectado
 * @returns {Object} Objeto de proyecciones estructurado
 */
function buildProjections(realHistory = [], now = new Date()) {
  const history = Array.isArray(realHistory) ? realHistory : [];
  const count = history.length;

  if (count < 3) {
    return {
      data_status: 'insuficiente',
      meses_con_datos: count,
      history,
      projectedMonth: null,
      projectedRevenue: null,
      trend: 'INSUFICIENTE'
    };
  }

  // Regresión lineal para 3 o más meses reales
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  history.forEach((h, index) => {
    const x = index + 1;
    const y = typeof h.revenue === 'number' ? h.revenue : parseFloat(h.revenue || 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });

  const denominator = (count * sumXX - sumX * sumX);
  const slope = denominator !== 0 ? (count * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / count;

  const nextMonthIndex = count + 1;
  const projectedRevenue = Math.max(0, Math.round(slope * nextMonthIndex + intercept));

  // Ronda 3 (CI-18): el mes proyectado es el mes CALENDARIO siguiente a `now`, anclado al día 1 y
  // formateado en local. Antes se hacía `setMonth` sobre HOY, y JavaScript normaliza (31 de enero + 1
  // mes = 3 de marzo) ⇒ la etiqueta saltaba un mes; y `toISOString()` es UTC, así que en husos positivos
  // hasta podía devolver el mes anterior. Determinista respecto de `now`, sin aritmética de meses sobre el día.
  const base = new Date(now);
  const anioBase = base.getFullYear();
  const mesBase = base.getMonth() + 1; // 1-12
  const mesProyectado = mesBase === 12 ? 1 : mesBase + 1;
  const anioProyectado = mesBase === 12 ? anioBase + 1 : anioBase;
  const projectedMonthStr = `${anioProyectado}-${String(mesProyectado).padStart(2, '0')}`;
  const trend = slope >= 0 ? 'CRECIENTE' : 'DECRECIENTE';

  return {
    data_status: 'completo',
    meses_con_datos: count,
    history,
    projectedMonth: projectedMonthStr,
    projectedRevenue,
    trend
  };
}

module.exports = {
  buildProjections
};
