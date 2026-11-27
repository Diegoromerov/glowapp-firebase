-- Allow the Aura business query counter already defined by the SaaS catalog.
-- The counter is written only for an authenticated, active business membership.
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
    'POS_INTEGRATION',
    'AURA_QUERIES'
  ));

COMMIT;
