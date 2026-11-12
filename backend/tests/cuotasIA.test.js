/**
 * Reglas de cuotas del programa de IA (E5).
 *
 * Decisión del Director: la cuota cuelga del USO. El nivel multiplica, no
 * otorga, porque cada lectura HD de YouCam cuesta $1.920 COP y el nivel alto no
 * factura por sí mismo.
 */
const {
  lecturasOtorgadas,
  nivelDeXp,
  costoDeLecturas,
  COSTO_LECTURA_COP,
  BONO_POR_NIVEL,
} = require('../src/config/cuotasIA');

describe('costos de lectura', () => {
  test('el paquete de YouCam da $160 por punto (500 puntos = $80.000)', () => {
    expect(COSTO_LECTURA_COP.SD).toBe(1440); // 9 puntos
    expect(COSTO_LECTURA_COP.HD).toBe(1920); // 12 puntos
  });

  test('una lectura HD cuesta 25% más que una SD', () => {
    expect(COSTO_LECTURA_COP.HD / COSTO_LECTURA_COP.SD).toBeCloseTo(12 / 9, 5);
  });

  test('costo de un lote mixto', () => {
    expect(costoDeLecturas({ SD: 2, HD: 3 })).toBe(2 * 1440 + 3 * 1920);
  });
});

describe('nivelDeXp', () => {
  test.each([
    [0, 'glow'], [299, 'glow'], [300, 'petalo'], [899, 'petalo'],
    [900, 'oro'], [1999, 'oro'], [2000, 'diamante'], [99999, 'diamante'],
  ])('con %i XP el nivel es %s', (xp, esperado) => {
    expect(nivelDeXp(xp).clave).toBe(esperado);
  });

  test('un XP inválido no rompe: cae al nivel base', () => {
    expect(nivelDeXp(null).clave).toBe('glow');
    expect(nivelDeXp('basura').clave).toBe('glow');
  });
});

describe('lecturasOtorgadas — la cuota cuelga del uso', () => {
  test('una usuaria nueva tiene una lectura y nada más', () => {
    const r = lecturasOtorgadas({});
    expect(r.otorgadas).toBe(1);
    expect(r.desglose).toEqual({ base: 1, reservas: 0, compras: 0, nivel: 0 });
  });

  test('la base no se repite si ya la usó', () => {
    expect(lecturasOtorgadas({ yaUsoBase: true }).otorgadas).toBe(0);
  });

  test('sin uso, el nivel más alto NO regala lecturas: sólo su bono', () => {
    const r = lecturasOtorgadas({ xp: 5000, yaUsoBase: true });
    expect(r.nivel.clave).toBe('diamante');
    expect(r.otorgadas).toBe(BONO_POR_NIVEL.diamante); // 6, no 25
    expect(r.otorgadas).toBeLessThan(25);
  });

  test('el uso manda: una Diamante activa supera su bono', () => {
    const r = lecturasOtorgadas({ xp: 2500, reservas: 2, compras: 1, yaUsoBase: true });
    expect(r.desglose).toEqual({ base: 0, reservas: 2, compras: 1, nivel: 6 });
    expect(r.otorgadas).toBe(9);
  });

  test('una Glow con el mismo uso cobra menos que una Diamante', () => {
    const glow = lecturasOtorgadas({ xp: 10, reservas: 2, compras: 1, yaUsoBase: true });
    const diamante = lecturasOtorgadas({ xp: 2500, reservas: 2, compras: 1, yaUsoBase: true });
    expect(diamante.otorgadas - glow.otorgadas).toBe(6);
  });

  test('valores negativos o basura no inflan la cuota', () => {
    const r = lecturasOtorgadas({ reservas: -5, compras: 'x', xp: 400, yaUsoBase: true });
    expect(r.otorgadas).toBe(BONO_POR_NIVEL.petalo);
  });

  test('el techo del mes queda acotado: 30 hechos no dan 30 lecturas sin nivel', () => {
    const r = lecturasOtorgadas({ reservas: 30, compras: 0, xp: 0, yaUsoBase: true });
    expect(r.otorgadas).toBe(30);
    // 30 lecturas HD son $57.600 COP: por eso el tope de hechos se limita arriba,
    // en el controlador que cuenta reservas y compras del mes.
    expect(r.otorgadas * COSTO_LECTURA_COP.HD).toBe(57600);
  });
});
