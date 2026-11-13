-- ==============================================================================
-- A VUE Migration 003: Tickets used_at Timestamp
-- Forward-only SQL migration.
-- Adds used_at timestamp column to tickets table for atomic redemption tracking.
-- ==============================================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('003_tickets_used_at.sql')
ON CONFLICT (filename) DO NOTHING;

