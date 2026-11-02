// backend/src/services/biometric/captureGeometry.service.js
//
// Y-F4 — Geometría de la captura validada en el servidor.
//
// Problema que resuelve: hasta ahora el cliente era la única autoridad sobre si la
// foto estaba de frente. `capture_screen.dart` medía los ángulos con ML Kit y
// bloqueaba >15°, pero nada de eso llegaba al backend: con una foto torcida o un
// cliente modificado, el análisis se pagaba igual y la medición entraba en la serie
// como si fuera comparable con las anteriores — que es justo lo que Y-F3 promete.
//
// Qué hace aquí:
//   1. Vuelve a validar los ángulos y la proporción del rostro con los mismos
//      umbrales que el cliente declara, para que no dependa de su buena fe.
//   2. Deja la medición guardada con la sesión, de modo que se pueda auditar con
//      qué geometría se tomó cada escaneo que entra en una comparación.
//
// Los umbrales son los mismos que ya usaba el cliente (heurísticas declaradas, no
// calibradas con fotos reales):
//   * |yaw|  <= 15°  mirada al frente
//   * |roll| <= 15°  cabeza sin inclinar
//   * |pitch|<= 20°  mentón ni arriba ni abajo
//   * faceRatio 0.22–0.85  distancia (ancho del rostro / ancho de la imagen)
//   * aspectRatio 0.7–1.8  proporción del recuadro del rostro

const LIMITS = {
  MAX_YAW: 15,
  MAX_ROLL: 15,
  MAX_PITCH: 20,
  MIN_FACE_RATIO: 0.22,
  MAX_FACE_RATIO: 0.85,
  MIN_ASPECT: 0.7,
  MAX_ASPECT: 1.8,
};

const CAMPOS = ['yaw', 'roll', 'pitch', 'faceRatio', 'aspectRatio', 'centerOffset'];

/** ¿Viene la geometría con valores utilizables? */
function isPresent(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  return CAMPOS.some((campo) => typeof geometry[campo] === 'number' && Number.isFinite(geometry[campo]));
}

/**
 * Evalúa la geometría declarada por el cliente.
 *
 * @param {Object|null} geometry
 * @param {Object} [opts]
 * @param {boolean} [opts.requerida] - si true, la ausencia de geometría es rechazo.
 * @returns {{provista: boolean, veredicto: string, motivos: Array, metricas: Object}}
 */
function assess(geometry, { requerida = false } = {}) {
  if (!isPresent(geometry)) {
    return {
      provista: false,
      veredicto: requerida ? 'RECHAZADA' : 'SIN_GEOMETRIA',
      motivos: requerida
        ? [{
            code: 'GEOMETRIA_AUSENTE',
            severity: 'RECHAZO',
            metric: null,
            message: 'La foto llegó sin ángulos de captura; no se puede verificar la posición del rostro.',
          }]
        : [],
      metricas: {},
    };
  }

  const metricas = {};
  for (const campo of CAMPOS) {
    if (typeof geometry[campo] === 'number' && Number.isFinite(geometry[campo])) {
      metricas[campo] = geometry[campo];
    }
  }

  const motivos = [];
  const yaw = Math.abs(metricas.yaw ?? 0);
  const roll = Math.abs(metricas.roll ?? 0);
  const pitch = Math.abs(metricas.pitch ?? 0);

  if (yaw > LIMITS.MAX_YAW) {
    motivos.push({
      code: 'ANGULO_LATERAL',
      severity: 'RECHAZO',
      metric: `yaw=${metricas.yaw.toFixed(1)}°`,
      message: 'Mira de frente a la cámara: el rostro está girado hacia un lado.',
    });
  }

  if (roll > LIMITS.MAX_ROLL) {
    motivos.push({
      code: 'CABEZA_INCLINADA',
      severity: 'RECHAZO',
      metric: `roll=${metricas.roll.toFixed(1)}°`,
      message: 'Mantén la cabeza erguida: está inclinada.',
    });
  }

  if (pitch > LIMITS.MAX_PITCH) {
    motivos.push({
      code: 'MENTON_FUERA_DE_EJE',
      severity: 'RECHAZO',
      metric: `pitch=${metricas.pitch.toFixed(1)}°`,
      message: 'Nivela la mirada: no mires hacia arriba ni hacia abajo.',
    });
  }

  const ratio = metricas.faceRatio;
  if (typeof ratio === 'number') {
    if (ratio < LIMITS.MIN_FACE_RATIO) {
      motivos.push({
        code: 'ROSTRO_LEJOS',
        severity: 'RECHAZO',
        metric: `faceRatio=${ratio.toFixed(2)}`,
        message: 'Acércate un poco más: el rostro ocupa muy poco de la foto.',
      });
    } else if (ratio > LIMITS.MAX_FACE_RATIO) {
      motivos.push({
        code: 'ROSTRO_CERCA',
        severity: 'RECHAZO',
        metric: `faceRatio=${ratio.toFixed(2)}`,
        message: 'Aléjate un poco: el rostro queda cortado en el encuadre.',
      });
    }
  }

  const aspecto = metricas.aspectRatio;
  if (typeof aspecto === 'number' && (aspecto < LIMITS.MIN_ASPECT || aspecto > LIMITS.MAX_ASPECT)) {
    motivos.push({
      code: 'ENCUADRE_INCORRECTO',
      severity: 'RECHAZO',
      metric: `aspectRatio=${aspecto.toFixed(2)}`,
      message: 'Encuadra el rostro completo, sin recortarlo ni estirarlo.',
    });
  }

  return {
    provista: true,
    veredicto: motivos.length === 0 ? 'ACEPTADA' : 'RECHAZADA',
    motivos,
    metricas,
  };
}

module.exports = { assess, isPresent, LIMITS };
