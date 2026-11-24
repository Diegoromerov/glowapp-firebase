-- Fase 1 SaaS: asegurar el catálogo mínimo que necesita la identidad de salón.
-- `salonIdentity` y `/api/saas/bootstrap` requieren al menos una vertical, y
-- `business_profiles.vertical_id` es NOT NULL con FK. El seed de aplicación no
-- se ejecuta en el arranque de Railway; esta migración hace persistente el
-- catálogo canónico definido en src/db/seed_business_data.js.
--
-- Idempotente y conservadora: no modifica filas existentes ni duplica códigos.
BEGIN;

INSERT INTO business_verticals (id, code, name, description)
VALUES
  ('vert-beauty-salon', 'BEAUTY_SALON', 'Peluquería / Salón de Belleza',
   'Establecimiento de corte, peinado, colorimetría y estética capilar.'),
  ('vert-barbershop', 'BARBERSHOP', 'Barbería',
   'Establecimiento especializado en cuidado de barba y corte masculino.'),
  ('vert-spa-massage', 'SPA_MASSAGE', 'Spa / Centro de Relajación',
   'Establecimiento de masajes, hidroterapia y bienestar.'),
  ('vert-aesthetics', 'AESTHETICS', 'Centro de Estética',
   'Tratamientos faciales y corporales no invasivos.')
ON CONFLICT DO NOTHING;

COMMIT;
