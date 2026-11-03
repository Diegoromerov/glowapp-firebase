/**
 * backend/src/middleware/consentMiddleware.js
 * Middleware Express para validar consentimiento biométrico antes de procesar datos sensibles
 * Cumple Ley 1581/2012: consentimiento previo, expreso, informado, verificable
 */

const { checkConsent, logAccess } = require('../services/consentService');

/**
 * Tipos de consentimiento requeridos por ruta
 */
const ROUTE_CONSENT_MAP = {
  '/api/biometric/analyze-face': 'facial_analysis',
  '/api/biometric/analyze-skin': 'skin_scan',
  '/api/biometric/analyze-hair': 'hair_analysis',
  '/api/biometric/virtual-try-on': 'virtual_try_on',
  '/api/aura/profile/biometric': 'all_biometric'
};

/**
 * Middleware factory que valida consentimiento para un tipo específico
 * @param {string} consentType - Tipo de consentimiento requerido
 * @returns {Function} Middleware Express
 */
function requireConsent(consentType) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Autenticación requerida para acceder a datos biométricos'
        });
      }
      
      const consent = await checkConsent(userId, consentType);
      
      if (!consent.granted) {
        // Log intento sin consentimiento (auditoría)
        await logAccess({
          userId,
          accessedBy: 'middleware',
          accessType: `attempt_${consentType}`,
          ip: req.ip,
          details: { 
            endpoint: req.originalUrl,
            method: req.method,
            consentType 
          }
        });
        
        return res.status(403).json({
          error: 'consent_required',
          consent_type: consentType,
          message: `Para usar esta función, necesitas otorgar consentimiento para el procesamiento de tus datos biométricos (${consentType}). Puedes hacerlo en Configuración > Privacidad > Datos Biométricos.`
        });
      }
      
      // Log acceso autorizado
      await logAccess({
        userId,
        accessedBy: 'middleware',
        accessType: `authorized_${consentType}`,
        ip: req.ip,
        details: { 
          endpoint: req.originalUrl,
          method: req.method,
          consentType 
        }
      });
      
      // Adjuntar info de consentimiento al request para uso posterior
      req.biometricConsent = { type: consentType, grantedAt: consent.grantedAt };
      next();
      
    } catch (error) {
      console.error('❌ Error en consentMiddleware:', error.message);
      // Fail closed por seguridad legal
      res.status(500).json({
        error: 'internal_error',
        message: 'Error verificando consentimiento biométrico'
      });
    }
  };
}

/**
 * Middleware que detecta automáticamente el tipo de consentimiento basado en la ruta
 * Útil para aplicar a múltiples rutas de una vez
 */
function autoConsentMiddleware() {
  return async (req, res, next) => {
    const consentType = ROUTE_CONSENT_MAP[req.path];
    
    if (!consentType) {
      // Ruta no requiere consentimiento biométrico específico
      return next();
    }
    
    return requireConsent(consentType)(req, res, next);
  };
}

/**
 * Middleware específico para rutas de AURA que requieren perfil biométrico
 * Verifica consentimiento 'all_biometric' o el específico según la acción
 */
function auraBiometricMiddleware() {
  return async (req, res, next) => {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Autenticación requerida para perfil biométrico'
      });
    }
    
    // Para AURA, requiere consentimiento completo o facial_analysis mínimo
    const consent = await checkConsent(userId, 'all_biometric');
    
    if (!consent.granted) {
      // Intentar consentimiento facial específico
      const faceConsent = await checkConsent(userId, 'facial_analysis');
      
      if (!faceConsent.granted) {
        await logAccess({
          userId,
          accessedBy: 'AURA',
          accessType: 'attempt_profile_biometric',
          ip: req.ip,
          details: { 
            endpoint: req.originalUrl,
            requiredConsent: 'all_biometric or facial_analysis'
          }
        });
        
        return res.status(403).json({
          error: 'consent_required',
          consent_type: 'all_biometric',
          message: 'Para acceder a tu perfil biométrico, necesitas otorgar consentimiento. Ve a Configuración > Privacidad > Datos Biométricos y habilita "Análisis Facial Completo" o "Todos los Datos Biométricos".'
        });
      }
    }
    
    // Log acceso autorizado
    await logAccess({
      userId,
      accessedBy: 'AURA',
      accessType: 'read_biometric_profile',
      ip: req.ip,
      details: { endpoint: req.originalUrl }
    });
    
    next();
  };
}

module.exports = {
  requireConsent,
  autoConsentMiddleware,
  auraBiometricMiddleware,
  ROUTE_CONSENT_MAP
};