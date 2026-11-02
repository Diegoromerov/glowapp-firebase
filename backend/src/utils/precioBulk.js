/**
 * Calculo del precio resultante de un ajuste masivo de precios.
 *
 * Vive aparte del controlador para poder probarlo con valores reales desde
 * node:test (el controlador necesita pool y no se puede importar en un test).
 *
 * FORMULA CORREGIDA: la version anterior calculaba
 *     despues = baseCalc * (numValor / 100)
 * de modo que un "+10%" NO sumaba un 10%: dejaba el precio en el 10% de su valor
 * (10000 -> 1000, un -90%). El endpoint nunca recibio una peticion valida —la
 * pagina enviaba otro formato y siempre daba 400—, asi que nadie lo noto. Si se
 * hubiera cableado tal cual, el primer ajuste masivo habria destruido los precios.
 *
 * @param {number} baseCalc  precio de partida (el de la lista, o el de cliente si no hay)
 * @param {string} tipo      'porcentaje' | 'fijar' | 'delta'
 * @param {number} numValor  valor de la operacion
 * @returns {number} precio resultante, nunca negativo
 */
function calcularPrecioBulk(baseCalc, tipo, numValor) {
  const base = Number.isFinite(baseCalc) && baseCalc > 0 ? baseCalc : 0;
  if (!Number.isFinite(numValor)) return 0;

  let despues = 0;
  if (tipo === 'porcentaje') {
    // Valor relativo: +10 = un 10% MAS sobre el precio base.
    despues = base * (1 + numValor / 100);
  } else if (tipo === 'fijar') {
    despues = numValor;
  } else if (tipo === 'delta') {
    despues = base + numValor;
  }

  return Math.max(0, Math.round(despues * 100) / 100);
}

module.exports = { calcularPrecioBulk };
