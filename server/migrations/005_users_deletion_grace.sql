-- ==============================================================================
-- A VUE Migration 005: Account Deletion Grace Period and Purge Fields
-- Forward-only SQL migration.
-- Adds deleted_at and purge_after to users table with a partial index for purge worker.
-- ==============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_purge_after ON users(purge_after) WHERE deleted_at IS NOT NULL;

-- Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('005_users_deletion_grace.sql')
ON CONFLICT (filename) DO NOTHING;
