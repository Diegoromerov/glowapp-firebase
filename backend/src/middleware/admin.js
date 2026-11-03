// Middleware para verificar que el usuario tenga el rol ADMIN
// Evita consultar nuevamente la base de datos si auth.js ya lo hizo

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autorizado. Token requerido.' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  }

  next();
};
