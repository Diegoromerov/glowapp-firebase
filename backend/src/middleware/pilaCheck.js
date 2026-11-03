// backend/src/middleware/pilaCheck.js
const { pool } = require('../config/db');

/**
 * Middleware para verificar si el prestador está suspendido por falta de pago o verificación de planilla PILA
 * conforme a la Cláusula Décima y Decimoprimera del contrato de proveedores.
 */
module.exports = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    // Solo verificamos la suspensión si el usuario logueado o involucrado actúa como PRESTADOR
    if (role === 'provider') {
      const result = await pool.query(
        'SELECT suspension_pila, pila_estado_verificacion FROM perfiles_prestador WHERE id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        const prestador = result.rows[0];
        
        if (prestador.suspension_pila || prestador.pila_estado_verificacion === 'VENCIDO') {
          return res.status(403).json({
            success: false,
            error: 'CUENTA_SUSPENDIDA_PILA',
            message: 'Tu cuenta se encuentra suspendida temporalmente para agendamiento de nuevas citas por incumplimiento en la acreditación del pago mensual de tu planilla de Seguridad Social (PILA) conforme a la Cláusula Décima del Contrato.'
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('❌ Error en middleware pilaCheck:', error);
    res.status(500).json({ error: 'Error interno del servidor al validar estatus de seguridad social.' });
  }
};
