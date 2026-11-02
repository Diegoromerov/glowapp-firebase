// backend/src/middleware/biometricConsentGuard.js
/**
 * Middleware Biometric Consent Guard (ADR-001 / GDPR Art. 6 & Ley 1581)
 *
 * Verifica que el usuario autenticado posea un consentimiento biométrico VÁLIDO
 * (otorgado y no revocado) antes de procesar cualquier escaneo.
 *
 * FASE C · t_fix_secapp_01 (hallazgo P0 «granted vs estado»): este guard
 * consultaba la columna legado de estado de la migración 026, mientras el resto
 * del backend autoriza con `granted = TRUE AND revoked_at IS NULL`. Como ese
 * flag legado no cambia al revocar, un usuario con consentimiento REVOCADO
 * seguía pasando el guard (fuga de datos biométricos). Ahora delega en la
 * fuente única de verdad (biometricConsent.js): un solo criterio de
 * autorización en todo el backend.
 */
const { hasAnyValidConsent } = require('./biometricConsent');

const biometricConsentGuard = async (req, res, next) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Se requiere autenticación para verificar la base legal biométrica.',
    });
  }

  try {
    // Criterio único: granted = TRUE AND revoked_at IS NULL (nunca el flag legado).
    const consent = await hasAnyValidConsent(userId);

    if (!consent) {
      console.warn(`⛔ [CONSENT_GUARD] Bloqueada petición biométrica para usuario ${userId}: Sin consentimiento válido (otorgado y no revocado).`);
      return res.status(403).json({
        error: 'CONSENT_DENIED',
        code: 'MISSING_VALID_CONSENT',
        message: 'No existe un consentimiento biométrico válido (otorgado y no revocado). Debe aceptar las políticas de tratamiento de datos antes de continuar.',
      });
    }

    // Inyectar consentimiento validado en la petición
    req.biometricConsent = consent;
    next();
  } catch (error) {
    console.error('❌ Error en biometricConsentGuard:', error.message);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error al verificar la validez legal del consentimiento biométrico.',
    });
  }
};

module.exports = biometricConsentGuard;
