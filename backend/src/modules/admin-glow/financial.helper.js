/**
 * Helper financiero para procesar liquidaciones de servicios en GlowApp (Colombia)
 * Procesa comisiones, impuestos y retenciones de ley, y ganancia neta.
 */

/**
 * Calcula el desglose financiero detallado para un servicio completado.
 * @param {number} valorBruto - El precio total cobrado al cliente por el servicio.
 * @returns {Object} Liquidación detallada con precisión de dos decimales.
 */
function calcularLiquidacion(valorBruto) {
  if (typeof valorBruto !== 'number' || isNaN(valorBruto) || valorBruto < 0) {
    throw new Error('El valor bruto del servicio debe ser un número positivo válido.');
  }

  // 1. Comisión de la Plataforma (GlowApp): 20%
  const comisionPlataforma = Math.round((valorBruto * 0.20) * 100) / 100;

  // 2. Impuestos y Retenciones Estatales de Ley (Colombia): 4% Retención en la Fuente simulada
  const impuestosRetencion = Math.round((valorBruto * 0.04) * 100) / 100;

  // 3. Ganancia Neta del Operador/Prestador: Vbruto - Comisión - Impuestos
  const gananciaNeta = Math.round((valorBruto - comisionPlataforma - impuestosRetencion) * 100) / 100;

  return {
    valorBruto,
    comisionPlataforma,
    impuestosRetencion,
    gananciaNeta
  };
}

module.exports = {
  calcularLiquidacion
};
