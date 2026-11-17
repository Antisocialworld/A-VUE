-- ==============================================================================
-- A VUE Migration 006: On-Demand Showtimes Source, Creation Tracking & Unique Constraint
-- Forward-only SQL migration. Non-destructive.
--
-- Query to identify any existing duplicate (screen_id, starts_at) pairs before applying index:
-- SELECT screen_id, starts_at, COUNT(*) AS count
-- FROM showtimes
-- GROUP BY screen_id, starts_at
-- HAVING COUNT(*) > 1;
-- ==============================================================================

-- 1. Add source column with CHECK constraint (seed | on_demand)
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'showtimes_source_check'
  ) THEN
    ALTER TABLE showtimes ADD CONSTRAINT showtimes_source_check CHECK (source IN ('seed', 'on_demand'));
  END IF;
END $$;

-- 2. Add created_at timestamp column only if missing (already defined in migration 001)
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Create UNIQUE index on (screen_id, starts_at) to prevent duplicate screen bookings
CREATE UNIQUE INDEX IF NOT EXISTS idx_showtimes_screen_starts_at_unique ON showtimes (screen_id, starts_at);

-- 4. Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('006_showtimes_on_demand.sql')
ON CONFLICT (filename) DO NOTHING;
