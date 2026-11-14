-- ==============================================================================
-- A VUE Migration 004: Add 'flagged' status to payments table
-- Forward-only SQL migration.
-- Allows payments with transaction verification discrepancies to be marked as 'flagged'.
-- ==============================================================================

DO $$
BEGIN
  -- Drop existing payments_status_check if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT payments_status_check;
  END IF;

  -- Add updated check constraint allowing 'flagged'
  ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'successful', 'failed', 'refunded', 'flagged'));
END $$;

-- Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('004_payments_flagged_status.sql')
ON CONFLICT (filename) DO NOTHING;

