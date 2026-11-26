-- Allow the SaaS direct-booking counter already used by the booking flow.
-- Previous CHECK constraints omitted this feature, so every counter insert
-- failed even though the catalog and controller exposed DIRECT_BOOKINGS.
BEGIN;

ALTER TABLE public.usage_metrics
  DROP CONSTRAINT IF EXISTS usage_metrics_feature_check;

ALTER TABLE public.usage_metrics
  ADD CONSTRAINT usage_metrics_feature_check
  CHECK (feature IN (
    'MAP_VISIBILITY',
    'ONLINE_BOOKING',
    'DIRECT_BOOKINGS',
    'TEAM_SEATS',
    'API_CALLS',
    'ADVANCED_ANALYTICS',
    'CUSTOM_BRANDING',
    'WHATSAPP_INTEGRATION',
    'POS_INTEGRATION'
  ));

COMMIT;
