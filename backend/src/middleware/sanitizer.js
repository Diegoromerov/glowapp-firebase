/**
 * Middleware de sanitización de entradas para prevenir XSS.
 *
 * SECAPP #2 (P0): el sanitizer anterior usaba regex casero (`<script>…`,
 * `javascript:`, `on\w+=`) que era evadible — p. ej. `<scr<script>ipt>` se
 * reensamblaba a un `<script>` vivo, `java\t<script>` y `on\0error=` no
 * coincidían con los patrones. La sanitización de HTML con regex no es segura.
 *
 * Ahora se delega en `sanitize-html` (parser HTML real + lista blanca vacía):
 * descarta TODO tag/atributo y escapa el texto restante, de modo que la salida
 * nunca puede reconstituir marcado activo, con independencia de la ofuscación.
 */
const sanitizeHtml = require('sanitize-html');

// Lista blanca vacía => se descartan todos los tags/atributos y el texto se
// devuelve escapado (no puede contener `<`/`>` crudos que formen un tag).
const SANITIZE_OPTIONS = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return sanitizeHtml(value, SANITIZE_OPTIONS);
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const sanitized = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        sanitized[key] = sanitizeValue(value[key]);
      }
    }
    return sanitized;
  } else if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  return value;
}

module.exports = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }
  if (req.params) {
    req.params = sanitizeValue(req.params);
  }
  next();
};
