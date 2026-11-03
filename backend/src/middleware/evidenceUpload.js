/**
 * Subida de evidencias del Business Center.
 *
 * POR QUÉ EXISTE
 * --------------
 * La ruta POST /api/v1/business/tasks/:id/evidence ya existía, pero el archivo
 * no viajaba: el cliente mandaba `file_path` dentro del JSON y el servidor
 * guardaba esa cadena como si fuera una evidencia. Es decir, se podía registrar
 * «/uploads/Certificado_Sanitario_2026.pdf» sin que ese archivo existiera (y la
 * UI lo mostraba como «Cargado»).
 *
 * Ahora el archivo se sube de verdad (multipart, campo `file`), se guarda en
 * disco y la ruta la decide el SERVIDOR. La carpeta backend/uploads está en
 * .gitignore: lo subido por los usuarios no entra al repositorio.
 *
 * Los errores de multer (tamaño, tipo, campo ausente) son culpa de la petición:
 * se responden como 400, no como 500.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const DESTINO = path.join(__dirname, '..', '..', 'uploads', 'evidence');
fs.mkdirSync(DESTINO, { recursive: true });

const TIPOS_PERMITIDOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const almacenamiento = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DESTINO),
  filename: (req, file, cb) => {
    // El nombre que envía el cliente no se usa como nombre en disco: se
    // reconstruye con el id de la tarea y bytes aleatorios para que no pueda
    // escapar de la carpeta ni sobrescribir un archivo existente.
    const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 10);
    const tarea = String(req.params.id || 'tarea').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    cb(null, `${tarea}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const subida = multer({
  storage: almacenamiento,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_PERMITIDOS.has(file.mimetype)) {
      return cb(new Error('TIPO_DE_ARCHIVO_NO_PERMITIDO: solo imágenes (jpeg, png, webp, heic) o PDF'));
    }
    cb(null, true);
  },
});

/** Middleware listo para la ruta. Un error de subida es un 400, nunca un 500. */
const subirEvidencia = (req, res, next) =>
  subida.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: `BAD_REQUEST: ${err.message}`,
      });
    }
    next();
  });

subirEvidencia.DESTINO = DESTINO;

module.exports = subirEvidencia;
