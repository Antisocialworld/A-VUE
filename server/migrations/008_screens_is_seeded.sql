-- ==============================================================================
-- A VUE Migration 008: Screen Seed Flag
-- Forward-only SQL migration.
--
-- Marks which screens receive deterministic seed showtimes (is_seeded = true).
-- Free screens (is_seeded = false) are used by on-demand scheduling.
-- Backfill is explicit by screen id (not by order or row cap).
-- ==============================================================================

-- 1. Add is_seeded flag with safe default (free/on-demand by default)
ALTER TABLE screens ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill seeded screens explicitly by id (VI Grand, VI VIP, Ikeja Main)
UPDATE screens
SET is_seeded = true
WHERE id IN (
  'b0000001-0000-4000-8000-000000000001',
  'b0000001-0000-4000-8000-000000000002',
  'b0000002-0000-4000-8000-000000000001'
);

-- 3. Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('008_screens_is_seeded.sql')
ON CONFLICT (filename) DO NOTHING;
