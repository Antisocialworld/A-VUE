-- ==============================================================================
-- A VUE Migration 001: Initial Core Schema & Append-Only Ledger
-- Forward-only SQL migration. Money in kobo (bigint).
-- UNIQUE(showtime_id, seat_id) safety net. pg_trgm for cinema search.
-- ==============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Migrations Ledger Table
CREATE TABLE IF NOT EXISTS migrations_ledger (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT, -- Nullable for future Google-only accounts
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 4. Sessions Table (Public ID + Argon2id hash of secret, Rule 02)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, -- Public random token ID
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 5. Email Verification & Reset Codes (Argon2id hash of 6-digit code)
CREATE TABLE IF NOT EXISTS auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  daily_send_count INT NOT NULL DEFAULT 1,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);

-- 6. Cinemas & Halls/Screens (Fuzzy Search via pg_trgm)
CREATE TABLE IF NOT EXISTS cinemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cinemas_name_trgm ON cinemas USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cinema_id UUID NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_seats INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_screens_cinema ON screens(cinema_id);

-- 7. Seats (>=300 per hall, states: standard, vip, wheelchair)
CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  row_label TEXT NOT NULL,
  seat_number INT NOT NULL,
  seat_type TEXT NOT NULL DEFAULT 'standard' CHECK (seat_type IN ('standard', 'vip', 'wheelchair')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(screen_id, row_label, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seats_screen ON seats(screen_id);

-- 8. Showtimes (Price in integer kobo)
CREATE TABLE IF NOT EXISTS showtimes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id TEXT NOT NULL, -- TMDB movie reference ID
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  price_kobo BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_showtimes_movie ON showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_screen_time ON showtimes(screen_id, starts_at);

-- 9. Bookings (Final safety net: UNIQUE showtime_id, seat_id)
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  showtime_id UUID NOT NULL REFERENCES showtimes(id),
  seat_id UUID NOT NULL REFERENCES seats(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bookings_showtime_seat UNIQUE (showtime_id, seat_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_showtime ON bookings(showtime_id);

-- 10. Payments (Idempotent, integer kobo)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_kobo BIGINT NOT NULL,
  fee_kobo BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE NOT NULL,
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- 11. Webhook Events (Dedupe by event_id)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Refund Ledger (Strictly Append-Only, Enforced in Database)
CREATE TABLE IF NOT EXISTS refund_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  amount_kobo BIGINT NOT NULL,
  reason TEXT NOT NULL,
  refund_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Database trigger enforcing append-only guarantee on refund_ledger
CREATE OR REPLACE FUNCTION prevent_refund_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'refund_ledger is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refund_ledger_immutable ON refund_ledger;
CREATE TRIGGER trg_refund_ledger_immutable
BEFORE UPDATE OR DELETE ON refund_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_refund_ledger_mutation();

-- 13. Background Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_next ON jobs(status, next_run_at);

-- Record migration in ledger
INSERT INTO migrations_ledger (filename)
VALUES ('001_initial_schema.sql')
ON CONFLICT (filename) DO NOTHING;

