// backend/src/services/biometric/youcam.client.js
//
// Cliente de AI Skin Analysis (Perfect Corp / YouCam API, S2S v2.0).
//
// Y-F1: la llamada se explota completa. Antes se pedían 5 acciones y se mapeaban 4
// campos planos con `ui_score`; la respuesta real de las acciones HD es anidada por
// subregión (`{ whole: { raw_score, ui_score, output_mask_name } }`, `hd_pore.forehead`,
// `hd_wrinkle.nasolabial`, `hd_skin_type.t_zone`...), así que el mapeador plano
// descartaba textura, acné, poros y arrugas por zona, y las máscaras ya pagadas.
//
// Lo que devuelve ahora:
//   - las 4 claves heredadas (hydration, wrinkles, spots, pores) para no romper al
//     orquestador ni al prompt de recomendación,
//   - `metrics`: todas las métricas con raw_score (float), ui_score, subregión y máscara,
//   - `skinType`, `skinAge`, `overall`, `masks`, `missing` y `providerTaskId`.
//
// Regla: ninguna acción opcional que falte hace fallar el análisis (se declara en
// `missing`), pero las 4 métricas heredadas siguen siendo obligatorias: sin ellas el
// diagnóstico no existe y el orquestador debe responder 503 en vez de inventar números.

const axios = require('axios');
const https = require('https');
const logger = require('../../config/logger');
const { executeWithResilience } = require('../../services/resilienceService');
const { defaultPolicy } = require('../../services/resiliencePolicy');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : (process.env.REJECT_UNAUTHORIZED !== 'false'),
});

/**
 * Las 16 acciones HD disponibles en v2.0. HD y SD no se pueden mezclar en una tarea:
 * se pide todo en HD para no perder subregiones ni máscaras.
 */
const SKIN_ANALYSIS_ACTIONS = Object.freeze([
  'hd_wrinkle',
  'hd_pore',
  'hd_texture',
  'hd_acne',
  'hd_oiliness',
  'hd_radiance',
  'hd_eye_bag',
  'hd_age_spot',
  'hd_dark_circle',
  'hd_droopy_upper_eyelid',
  'hd_droopy_lower_eyelid',
  'hd_firmness',
  'hd_moisture',
  'hd_redness',
  'hd_tear_trough',
  'hd_skin_type',
]);

/**
 * Nombres de las acciones SD que la API puede devolver si alguien pide ese modo.
 * Se normalizan a su equivalente HD para que el parseo y las claves heredadas no
 * dependan del modo elegido.
 */
const ACTION_ALIASES = Object.freeze({
  wrinkle: 'hd_wrinkle',
  pore: 'hd_pore',
  texture: 'hd_texture',
  acne: 'hd_acne',
  oiliness: 'hd_oiliness',
  radiance: 'hd_radiance',
  eye_bag: 'hd_eye_bag',
  age_spot: 'hd_age_spot',
  dark_circle: 'hd_dark_circle',
  dark_circle_v2: 'hd_dark_circle',
  droopy_upper_eyelid: 'hd_droopy_upper_eyelid',
  droopy_lower_eyelid: 'hd_droopy_lower_eyelid',
  firmness: 'hd_firmness',
  moisture: 'hd_moisture',
  redness: 'hd_redness',
  tear_trough: 'hd_tear_trough',
  skin_type: 'hd_skin_type',
  skin_age: 'skin_age',
});

/** Claves heredadas que el resto de la app consume; sin ellas no hay diagnóstico. */
const REQUIRED_LEGACY_KEYS = Object.freeze(['hydration', 'wrinkles', 'spots', 'pores']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const firstMaskUrl = (item) => {
  if (Array.isArray(item?.mask_urls) && item.mask_urls.length > 0) return item.mask_urls[0];
  if (typeof item?.mask_url === 'string' && item.mask_url) return item.mask_url;
  return null;
};

/** ¿Hay al menos una métrica de ese tipo (plana o por subregión)? */
function metadataHasType(metrics, type) {
  const prefix = `${type}.`;
  return Object.prototype.hasOwnProperty.call(metrics, type)
    || Object.keys(metrics).some((key) => key.startsWith(prefix));
}

class YouCamClient {
  constructor() {
    this.apiKey = process.env.YOUCAM_API_KEY || process.env.YOCAM_API_KEY;
    this.baseUrl = 'https://yce-api-01.makeupar.com/s2s/v2.0';
    this.timeout = 15000; // 15 segundos por request individual
    this.pollIntervalMs = 3000; // 3 segundos entre polls
    this.pollTimeoutMs = 60000; // 60 segundos máximo esperando el resultado
  }

  get authHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Paso 1: solicita un slot de subida y devuelve el file_id con la URL prefirmada. */
  async _requestUploadSlot(buffer, traceId) {
    const base64Image = buffer.toString('base64');
    // executeWithResilience devuelve el valor crudo de la función, así que aquí se
    // desenvuelve la respuesta de axios. Antes se devolvía la respuesta completa y el
    // llamador desestructuraba fileId/uploadUrl de un objeto axios => siempre undefined.
    const payload = await executeWithResilience(async () => {
      const response = await axios.post(
        `${this.baseUrl}/file/skin-analysis`,
        {
          files: [
            {
              file_name: 'user_face.jpg',
              file_size: buffer.length,
              content_type: 'image/jpeg',
              data: base64Image,
            }
          ]
        },
        { headers: this.authHeaders, httpsAgent, timeout: this.timeout }
      );
      return response.data;
    }, {
      retry: defaultPolicy.retry,
      retryDelay: defaultPolicy.retryDelay,
      // Use default policy timeout (5000ms) for resilience, not the axios timeout
      circuitBreakerName: 'youcam',
      traceId: traceId,
    });

    const file = payload?.data?.files?.[0] || payload?.files?.[0];
    const uploadRequest = file?.requests?.[0];
    const fileId = file?.file_id || file?.fileId;
    const uploadUrl = uploadRequest?.url || file?.upload_url;
    const uploadHeaders = uploadRequest?.headers || file?.headers;

    if (!fileId || !uploadUrl) {
      throw new Error('YouCam no devolvió file_id o URL de subida en el slot de archivo.');
    }
    return { fileId, uploadUrl, uploadHeaders };
  }

  /** Paso 2: sube la imagen directamente a S3 usando la URL pre-firmada. */
  async _uploadToS3(uploadUrl, uploadHeaders, buffer, traceId) {
    await executeWithResilience(async () => {
      await axios.put(uploadUrl, buffer, {
        headers: {
          ...uploadHeaders,
          'Content-Type': uploadHeaders?.['Content-Type'] || 'image/jpeg',
          'Content-Length': buffer.length,
        },
        httpsAgent,
        timeout: this.timeout,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    }, {
      retry: defaultPolicy.retry,
      retryDelay: defaultPolicy.retryDelay,
      // Use default policy timeout (5000ms) for resilience
      circuitBreakerName: 'youcam',
      traceId: traceId,
    });
  }

  /** Paso 3: crea la tarea de análisis con las 16 acciones HD. */
  async _createAnalysisTask(fileId, traceId) {
    const response = await executeWithResilience(async () => {
      return await axios.post(
        `${this.baseUrl}/task/skin-analysis`,
        {
          request_id: 1,
          src_file_id: fileId,
          dst_actions: [...SKIN_ANALYSIS_ACTIONS],
        },
        { headers: this.authHeaders, httpsAgent, timeout: this.timeout }
      );
    }, {
      retry: defaultPolicy.retry,
      retryDelay: defaultPolicy.retryDelay,
      // Use default policy timeout (5000ms) for resilience
      circuitBreakerName: 'youcam',
      traceId: traceId,
    });

    logger.debug('YouCam create task response', { data: response.data });
    const taskId = response.data?.result?.task_id || response.data?.task_id || response.data?.data?.task_id;
    if (!taskId) {
      throw new Error(`YouCam no devolvió un task_id al crear la tarea de análisis. Respuesta: ${JSON.stringify(response.data)}`);
    }
    return taskId;
  }

  /** Paso 4: consulta el resultado con polling hasta que la tarea termine. */
  async _pollTaskResult(taskId, traceId) {
    const start = Date.now();

    while (Date.now() - start < this.pollTimeoutMs) {
      const response = await executeWithResilience(async () => {
        return await axios.get(
          `${this.baseUrl}/task/skin-analysis/${taskId}`,
          { headers: this.authHeaders, httpsAgent, timeout: this.timeout }
        );
      }, {
        retry: defaultPolicy.retry,
        retryDelay: defaultPolicy.retryDelay,
        // Use default policy timeout (5000ms) for resilience
        circuitBreakerName: 'youcam',
        traceId: traceId,
      });

      const body = response.data;
      const status = body?.data?.task_status || body?.task_status;

      if (status === 'success') {
        return body?.data?.results || body?.results;
      }

      if (status === 'error') {
        throw new Error(`YouCam reportó error en la tarea de análisis: ${JSON.stringify(body)}`);
      }

      // status === 'running' / 'processing' / etc. -> seguimos esperando
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new Error(`YouCam: tiempo de espera agotado consultando el resultado de la tarea ${taskId}.`);
  }

  /** Normaliza el tipo devuelto por la API (HD o SD) a su clave canónica. */
  _canonicalType(type) {
    if (typeof type !== 'string') return null;
    const clean = type.trim();
    if (!clean) return null;
    return ACTION_ALIASES[clean] || clean;
  }

  /**
   * Convierte la respuesta de YouCam (array `output` u objeto por acción) en una lista
   * `[tipoCanónico, valor]`. Soporta las tres formas documentadas: acción plana,
   * acción con subregiones y etiqueta de texto (skin_type).
   */
  _entries(results) {
    if (!results) return [];

    const output = results.output;
    if (Array.isArray(output)) {
      return output
        .filter((item) => item && typeof item === 'object')
        .map((item) => [this._canonicalType(item.type), item]);
    }
    if (Array.isArray(results)) {
      return results
        .filter((item) => item && typeof item === 'object')
        .map((item) => [this._canonicalType(item.type), item]);
    }
    if (typeof results === 'object') {
      return Object.entries(results)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, value]) => [this._canonicalType(key), value]);
    }
    return [];
  }

  /** Convierte un valor escalar de YouCam en métrica, o devuelve null si no lo es. */
  _toMetric(key, value) {
    if (value === null || value === undefined) return null;

    if (isFiniteNumber(value)) {
      return { key, kind: 'score', raw_score: value, ui_score: null, label: null, mask_name: null, mask_url: null };
    }
    if (typeof value === 'string') {
      return { key, kind: 'label', raw_score: null, ui_score: null, label: value, mask_name: null, mask_url: null };
    }
    if (typeof value !== 'object' || Array.isArray(value)) return null;

    const hasScore = isFiniteNumber(value.raw_score) || isFiniteNumber(value.ui_score) || isFiniteNumber(value.score);
    if (hasScore) {
      return {
        key,
        kind: key === 'skin_age' ? 'age' : (key === 'all' ? 'overall' : 'score'),
        raw_score: isFiniteNumber(value.raw_score) ? value.raw_score : (isFiniteNumber(value.score) ? value.score : null),
        ui_score: isFiniteNumber(value.ui_score) ? value.ui_score : null,
        label: typeof value.value === 'string' ? value.value : null,
        mask_name: typeof value.output_mask_name === 'string' ? value.output_mask_name : null,
        mask_url: firstMaskUrl(value),
      };
    }
    return null;
  }

  /**
   * Parsea la respuesta completa a un mapa de métricas por subregión más los bloques
   * derivados (skinType, skinAge, overall) y las claves heredadas.
   */
  _parseResults(results) {
    const metrics = {};
    const skinType = { whole: null, tZone: null, uZone: null, raw: null };

    for (const [type, value] of this._entries(results)) {
      if (!type) continue;

      const direct = this._toMetric(type, value);
      if (direct) {
        metrics[type] = direct;
        if (type === 'hd_skin_type' && direct.label) skinType.whole = direct.label;
        continue;
      }

      if (typeof value !== 'object' || Array.isArray(value)) continue;

      for (const [region, regionValue] of Object.entries(value)) {
        if (region.startsWith('_')) continue;
        const metric = this._toMetric(`${type}.${region}`, regionValue);
        if (!metric) continue;
        metrics[metric.key] = metric;

        if (type === 'hd_skin_type') {
          if (region === 'whole') skinType.whole = metric.label;
          else if (region === 't_zone' || region === 'tZone') skinType.tZone = metric.label;
          else if (region === 'u_zone' || region === 'uZone') skinType.uZone = metric.label;
        }
      }
    }

    const uiOf = (...keys) => {
      for (const key of keys) {
        const metric = metrics[key];
        if (metric && isFiniteNumber(metric.ui_score)) return metric.ui_score;
        if (metric && isFiniteNumber(metric.raw_score)) return metric.raw_score;
      }
      return null;
    };
    const rawOf = (...keys) => {
      for (const key of keys) {
        const metric = metrics[key];
        if (metric && isFiniteNumber(metric.raw_score)) return metric.raw_score;
      }
      return null;
    };

    const skinAge = {
      raw: rawOf('skin_age'),
      ui: metrics.skin_age ? metrics.skin_age.ui_score : null,
    };
    const overall = {
      raw: rawOf('all', 'overall'),
      ui: metrics.all ? metrics.all.ui_score : (metrics.overall ? metrics.overall.ui_score : null),
    };

    const requested = [...SKIN_ANALYSIS_ACTIONS];
    const missing = requested.filter((action) => !metadataHasType(metrics, action));

    const faceScores = {
      // Claves heredadas: el orquestador, el prompt y el GlowScore dependen de ellas.
      hydration: uiOf('hd_moisture'),
      wrinkles: uiOf('hd_wrinkle.whole', 'hd_wrinkle'),
      spots: uiOf('hd_age_spot'),
      pores: uiOf('hd_pore.whole', 'hd_pore'),
      // Y-F2: `hd_skin_type` devuelve el TIPO de piel (Oily/Dry/Normal/Combination),
      // no el subtono. Antes se publicaba aquí y Flutter lo usaba como subtono, cayendo
      // siempre en el valor por defecto. El subtono lo mide undertone.service sobre la
      // foto; aquí se declara el tipo y se deja el subtono en null.
      pielTipo: skinType.whole || null,
      subtono: null,
      bioAge: isFiniteNumber(skinAge.raw) ? skinAge.raw : (isFiniteNumber(skinAge.ui) ? skinAge.ui : null),
      // Capa rica (Y-F1)
      metrics,
      skinType,
      skinAge,
      overall,
      masks: Object.values(metrics)
        .filter((metric) => metric.mask_url || metric.mask_name)
        .map((metric) => ({ key: metric.key, url: metric.mask_url, name: metric.mask_name })),
      requestedActions: requested,
      missing,
      raw: results,
    };

    const missingRequired = REQUIRED_LEGACY_KEYS.filter((key) => !isFiniteNumber(faceScores[key]));
    if (missingRequired.length > 0) {
      throw new Error(
        `YouCam no devolvió las métricas obligatorias: ${missingRequired.join(', ')}. ` +
        `Acciones recibidas: ${Object.keys(metrics).join(', ') || 'ninguna'}.`
      );
    }

    return faceScores;
  }

  /** Compatibilidad: el nombre anterior del parser. */
  _mapResultsToScores(results) {
    return this._parseResults(results);
  }

  /** Analiza una imagen de rostro y devuelve scores dérmicos completos.
   * Ejecuta el flujo completo de 4 pasos: upload slot -> subida S3 -> crear tarea -> poll resultado.
   * @param {Buffer|string} image - Imagen en base64 o buffer
   * @param {string} [traceId] - Optional trace ID for logging and correlation
   * @returns {Promise<Object>} Scores de piel (heredados + métricas por subregión)
   */
  async analyzeFace(image, traceId) {
    logger.info('Iniciando análisis facial con YouCam', { imageSize: image.length || 'unknown' });

    if (!this.apiKey || this.apiKey === 'tu_api_key_aqui') {
      throw new Error('YouCam API key no configurada; no se pueden obtener datos biométricos de rostro.');
    }

    try {
      const base64Image = typeof image === 'string' ? image : image.toString('base64');
      const buffer = Buffer.from(base64Image, 'base64');

      // Paso 1: slot de subida
      const { fileId, uploadUrl, uploadHeaders } = await this._requestUploadSlot(buffer, traceId);

      // Paso 2: subir a S3
      await this._uploadToS3(uploadUrl, uploadHeaders, buffer, traceId);

      // Paso 3: crear tarea de análisis
      const taskId = await this._createAnalysisTask(fileId, traceId);

      // Paso 4: poll hasta obtener resultado
      const results = await this._pollTaskResult(taskId, traceId);

      logger.info('Análisis YouCam completado exitosamente', { taskId });

      const parsed = this._parseResults(results);
      parsed.providerTaskId = taskId;
      return parsed;
    } catch (error) {
      logger.error('YouCam API error:', error.response?.data || error.message);
      throw new Error(`YouCam failed: ${error.message}`);
    }
  }
}

module.exports = new YouCamClient();
module.exports.SKIN_ANALYSIS_ACTIONS = SKIN_ANALYSIS_ACTIONS;
