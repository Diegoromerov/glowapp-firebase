// backend/src/schemas/biometric.schema.js
const { z } = require('zod');

/**
 * Zod Schema para la validación estricta de POST /api/biometric/analyze y /api/biometric/scan
 * Cumplimiento ADR-001 (Checklist Item 3): Validación Zod obligatoria en endpoints mutantes.
 */
/**
 * Y-F4 — geometría de la captura medida por el cliente (ML Kit).
 *
 * Se acepta ausente por compatibilidad con clientes anteriores; el servicio
 * `captureGeometry` decide si eso basta o si hay que rechazar (modo estricto).
 * Los rangos aquí son sólo de cordura: el juicio vive en el servicio, no en Zod.
 */
const biometricGeometrySchema = z.object({
  yaw: z.number().min(-180).max(180),
  roll: z.number().min(-180).max(180),
  pitch: z.number().min(-180).max(180).optional(),
  faceRatio: z.number().min(0).max(1).optional(),
  aspectRatio: z.number().min(0).max(5).optional(),
  centerOffset: z.number().min(0).max(2).optional(),
}).strict();

const biometricAnalyzeSchema = z.object({
  faceImage: z.string().min(1, 'La imagen facial base64 es obligatoria'),
  handsImage: z.string().optional().nullable(),
  entryPoint: z.enum(['ideas', 'vto', 'scanner', 'other']).default('ideas'),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  consentToken: z.string().optional().nullable(),
  geometry: biometricGeometrySchema.optional().nullable(),
});

/**
 * Zod Schema para la validación estricta de la consulta de perfil biométrico
 */
const biometricProfileParamSchema = z.object({
  userId: z.string().or(z.number()).transform((val) => String(val)),
});

module.exports = {
  biometricAnalyzeSchema,
  biometricProfileParamSchema,
};
