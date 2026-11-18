-- ==============================================================================
-- A VUE Migration 007: Screen Prices
-- Forward-only SQL migration. Money in integer kobo (BIGINT).
--
-- Screens carry their own price so on-demand scheduling does not depend on a
-- screen having showtime history. NULL means "price not set"; such screens are
-- skipped by on-demand scheduling rather than given an invented price.
-- ==============================================================================

-- 1. Add nullable price column with the same type as showtimes.price_kobo (BIGINT)
ALTER TABLE screens ADD COLUMN IF NOT EXISTS price_kobo BIGINT;

-- 2. Guarded CHECK: positive kobo or NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screens_price_kobo_check'
  ) THEN
    ALTER TABLE screens ADD CONSTRAINT screens_price_kobo_check
      CHECK (price_kobo IS NULL OR price_kobo > 0);
  END IF;
END $$;

-- 3. Backfill NULL prices from each screen's most recent showtime
UPDATE screens s
SET price_kobo = (
  SELECT st.price_kobo
  FROM showtimes st
  WHERE st.screen_id = s.id
  ORDER BY st.starts_at DESC
  LIMIT 1
)
WHERE s.price_kobo IS NULL;

-- 4. Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('007_screens_price.sql')
ON CONFLICT (filename) DO NOTHING;
