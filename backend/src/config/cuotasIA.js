/**
 * Reglas de cuotas de análisis con IA.
 *
 * Decisión del Director (2026-11-12): LA CUOTA CUELGA DEL USO, no del nivel
 * solo. Un nivel que regala lecturas a quien no compra es pérdida pura: cada
 * lectura HD de YouCam cuesta $1.920 COP y el nivel más alto no factura nada por
 * sí mismo.
 *
 * El nivel, entonces, multiplica; no otorga. Todo lo demás se gana con hechos
 * verificables: una reserva completada, una compra pagada.
 *
 * Costos (tarifa real del paquete, 500 puntos = $80.000 COP):
 *   1 punto YouCam = $160 COP
 *   lectura SD (9 puntos)  = $1.440 COP
 *   lectura HD (12 puntos) = $1.920 COP
 */
const COP_POR_PUNTO_YOUCAM = 160;
const PUNTOS_LECTURA = { SD: 9, HD: 12 }; // 9 y 12 según la documentación de YouCam

const COSTO_LECTURA_COP = {
  SD: PUNTOS_LECTURA.SD * COP_POR_PUNTO_YOUCAM,
  HD: PUNTOS_LECTURA.HD * COP_POR_PUNTO_YOUCAM,
};

// Lo que se otorga por hechos del mes.
const BASE_AL_REGISTRARSE = 1;      // una sola, para que pruebe el producto
const POR_RESERVA_COMPLETADA = 1;   // la cita se completó, no se canceló
const POR_COMPRA_PAGADA = 1;        // mismo umbral que el premio de referido

// Tope por concepto y mes. Sin él, 30 reservas darían 30 lecturas = $57.600 COP
// para una sola usuaria: el uso manda, pero no sin techo.
const TOPE_POR_CONCEPTO_MES = 3;

// Lo que suma el nivel, una vez al mes (no por hecho).
const BONO_POR_NIVEL = { glow: 0, petalo: 1, oro: 3, diamante: 6 };
const NIVELES = [
  { clave: 'glow', nombre: 'Glow', xp: 0 },
  { clave: 'petalo', nombre: 'Pétalo', xp: 300 },
  { clave: 'oro', nombre: 'Oro', xp: 900 },
  { clave: 'diamante', nombre: 'Diamante', xp: 2000 },
];

/** Nivel a partir del XP acumulado. Se calcula, no se guarda. */
function nivelDeXp(xp) {
  const total = Number.isFinite(Number(xp)) ? Number(xp) : 0;
  let actual = NIVELES[0];
  for (const n of NIVELES) if (total >= n.xp) actual = n;
  return actual;
}

/**
 * Lecturas otorgadas en el mes.
 *
 * Función pura a propósito: la aritmética del programa se decide aquí y se
 * prueba aquí, sin base de datos. Quien la llama trae los hechos contados.
 *
 * @param {{ reservas?: number, compras?: number, xp?: number, yaUsoBase?: boolean }} hechos
 * @returns {{ nivel: object, otorgadas: number, desglose: object }}
 */
function lecturasOtorgadas({ reservas = 0, compras = 0, xp = 0, yaUsoBase = false } = {}) {
  const nivel = nivelDeXp(xp);
  const desglose = {
    base: yaUsoBase ? 0 : BASE_AL_REGISTRARSE,
    reservas:
      Math.min(Math.max(0, Math.trunc(Number(reservas) || 0)), TOPE_POR_CONCEPTO_MES) *
      POR_RESERVA_COMPLETADA,
    compras:
      Math.min(Math.max(0, Math.trunc(Number(compras) || 0)), TOPE_POR_CONCEPTO_MES) *
      POR_COMPRA_PAGADA,
    nivel: BONO_POR_NIVEL[nivel.clave] || 0,
  };
  const otorgadas = Object.values(desglose).reduce((a, b) => a + b, 0);
  return { nivel, otorgadas, desglose };
}

/** Costo en COP de un conjunto de lecturas. */
function costoDeLecturas({ SD = 0, HD = 0 } = {}) {
  return (SD * COSTO_LECTURA_COP.SD) + (HD * COSTO_LECTURA_COP.HD);
}

module.exports = {
  COP_POR_PUNTO_YOUCAM,
  PUNTOS_LECTURA,
  COSTO_LECTURA_COP,
  BASE_AL_REGISTRARSE,
  POR_RESERVA_COMPLETADA,
  POR_COMPRA_PAGADA,
  TOPE_POR_CONCEPTO_MES,
  BONO_POR_NIVEL,
  NIVELES,
  nivelDeXp,
  lecturasOtorgadas,
  costoDeLecturas,
};
