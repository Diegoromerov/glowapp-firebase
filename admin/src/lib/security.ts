/**
 * FIX-FLUTTER-04 — Saneamiento de salidas (XSS) y minimización de PII.
 *
 * Funciones puras y sin dependencias (el worktree no instala paquetes, por lo
 * que se sustituye DOMPurify por una neutralización explícita y auditable).
 *
 * Contexto: React ya escapa los nodos de texto por defecto, de modo que
 * `{valor}` no ejecuta HTML. Estas utilidades añaden una capa explícita en el
 * límite de render (defensa en profundidad) y evitan que valores controlados
 * por el backend fluyan a contextos activos (href, atributos, nombres de
 * archivo, logs) o que se muestren datos personales sin minimizar.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa los metacaracteres HTML de un valor arbitrario. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}

/**
 * Neutraliza texto controlado por el backend antes de renderizarlo:
 * elimina caracteres de control, etiquetas/vectores activos y esquemas
 * peligrosos, y escapa lo restante.
 */
export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const cleaned = String(value)
    // Caracteres de control (excepto \t \n \r).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Etiquetas completas: <script ...>, </div>, <img onerror=... />, <svg/onload=...>
    .replace(/<\s*\/?\s*[a-zA-Z][^>]*>/g, '')
    // Resto de ángulos sueltos.
    .replace(/</g, '')
    .replace(/>/g, '')
    // Esquemas activos.
    .replace(/(javascript|vbscript|data)\s*:/gi, '')
    .trim();
  return escapeHtml(cleaned);
}

/**
 * Neutraliza rutas/identificadores de archivo: sin esquemas activos, sin
 * traversal y sin etiquetas. Pensado para valores que pueden acabar en un
 * `href`, un `download` o un log.
 */
export function sanitizePath(value: unknown): string {
  if (value === null || value === undefined) return '';
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/(javascript|vbscript|data|file)\s*:/gi, '')
    .replace(/\.{2,}[\\/]/g, '')
    .replace(/[\\/]{2,}/g, '/')
    .replace(/</g, '')
    .replace(/>/g, '')
    .trim();
  return escapeHtml(cleaned);
}

/**
 * Minimiza el nombre del profesional: solo iniciales. Nunca devuelve el nombre
 * completo (evita contacto fuera de la plataforma y filtración de PII).
 */
export function maskProviderName(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Profesional asignado';
  const initials = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}.`)
    .join(' ');
  return initials || 'Profesional asignado';
}

/**
 * Minimiza la dirección de servicio: conserva solo la ciudad/localidad y
 * redacta la dirección exacta (calle, número, apartamento).
 */
export function maskServiceAddress(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const locality = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!locality) return 'Dirección exacta protegida';
  // Sin dígitos/#/-: no se puede reconstruir la dirección exacta.
  const safeLocality = locality.replace(/[0-9#-]/g, '').replace(/\s{2,}/g, ' ').trim();
  return safeLocality ? `${safeLocality} (dirección exacta protegida)` : 'Dirección exacta protegida';
}

/**
 * Importe visible para el cliente: entero en COP. No expone el desglose
 * interno del negocio (comisión de plataforma, impuestos, neto del prestador).
 */
export function toClientVisibleAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

/** Política CSP conservadora y compatible con Next.js (App Router + Tailwind). */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

/** Cabeceras de seguridad aplicadas por next.config.ts y middleware.ts. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];
