-- D-001 Implementation: Add tenant_id to core tables (nullable) - REPAIRED
-- This migration adds tenant_id to tables that require multi-tenancy isolation as nullable.
-- It is idempotent and safe to run multiple times.
-- The foreign key and NOT NULL constraint will be added in later migrations after backfilling.

ALTER TABLE IF EXISTS usuarios ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS services ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS bookings ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS reviews ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS portfolio_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS messages ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS nail_tryon_jobs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS sos_alerts ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS user_activity_logs ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE IF EXISTS perfiles_prestador ADD COLUMN IF NOT EXISTS tenant_id INTEGER;