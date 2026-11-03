-- 101_add_consent_version_to_scan_sessions.sql
-- Y-F1b: cada análisis facial registra con qué versión del consentimiento se autorizó.
--
-- `consent_version` guarda el `version_terms` vigente en el momento del escaneo (copia
-- inmutable: si el usuario vuelve a aceptar una versión nueva, el análisis viejo sigue
-- diciendo qué texto lo autorizó).
-- `consent_outdated` marca los análisis hechos con un texto anterior al vigente para
-- poder pedir re-consentimiento sin invalidar el permiso ya otorgado.

ALTER TABLE biometric_scan_sessions
  ADD COLUMN IF NOT EXISTS consent_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS consent_outdated BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN biometric_scan_sessions.consent_version IS
  'version_terms del consentimiento vigente al momento del escaneo (Y-F1b)';
COMMENT ON COLUMN biometric_scan_sessions.consent_outdated IS
  'TRUE si el escaneo se autorizó con una versión anterior del texto de consentimiento';
