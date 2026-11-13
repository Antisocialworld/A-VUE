-- ==============================================================================
-- A VUE Migration 002: Cinema Showtimes, Seats, Payments & Ledger Schema
-- Forward-only SQL migration. Money in integer kobo (bigint).
-- UNIQUE(showtime_id, seat_id) safety net.
-- UNIQUE(user_id, idempotency_key) for payment idempotency.
-- Append-only trigger for financial ledger (money in/out).
-- ==============================================================================

-- 1. Ensure Halls Table / Compatibility with Screens
CREATE TABLE IF NOT EXISTS halls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cinema_id UUID NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_seats INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_halls_cinema ON halls(cinema_id);

-- 2. Extend Seats Table with row, number, accessible boolean
ALTER TABLE seats ADD COLUMN IF NOT EXISTS hall_id UUID REFERENCES screens(id) ON DELETE CASCADE;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS "row" TEXT;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS "number" INT;
ALTER TABLE seats ADD COLUMN IF NOT EXISTS accessible BOOLEAN NOT NULL DEFAULT false;

UPDATE seats SET "row" = row_label WHERE "row" IS NULL;
UPDATE seats SET "number" = seat_number WHERE "number" IS NULL;
UPDATE seats SET accessible = (seat_type = 'wheelchair') WHERE accessible IS false;
UPDATE seats SET hall_id = screen_id WHERE hall_id IS NULL;

-- 3. Extend Showtimes Table with cancelled_at and hall_id
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS hall_id UUID REFERENCES screens(id) ON DELETE CASCADE;
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
UPDATE showtimes SET hall_id = screen_id WHERE hall_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_showtimes_cancelled ON showtimes(cancelled_at);

-- 4. Ensure Bookings Table Unique Constraint (showtime_id, seat_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_bookings_showtime_seat'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT uq_bookings_showtime_seat UNIQUE (showtime_id, seat_id);
  END IF;
END $$;

-- 5. Extend Payments Table with user-scoped idempotency unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_user_idempotency'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT uq_payments_user_idempotency UNIQUE (user_id, idempotency_key);
  END IF;
END $$;

-- 6. Dedicated Idempotency Keys Table (Rule 03: UNIQUE user+route+key, 24 h expiry)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  response_status INT NOT NULL,
  response_body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_idempotency_user_route_key UNIQUE (user_id, route, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- 7. Refunds Table
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  payment_id UUID REFERENCES payments(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_kobo BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  refund_ref TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_booking ON refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_ref ON refunds(refund_ref);

-- 8. General Financial Ledger (Money In / Money Out, Append-Only)
CREATE TABLE IF NOT EXISTS ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('payment_in', 'refund_out', 'fee_in', 'fee_refund_out')),
  amount_kobo BIGINT NOT NULL,
  user_id UUID REFERENCES users(id),
  booking_id UUID REFERENCES bookings(id),
  payment_id UUID REFERENCES payments(id),
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_booking ON ledger(booking_id);
CREATE INDEX IF NOT EXISTS idx_ledger_payment ON ledger(payment_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at);

-- Database trigger enforcing append-only guarantee on ledger (Rule 03)
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger is strictly append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_immutable ON ledger;
CREATE TRIGGER trg_ledger_immutable
BEFORE UPDATE OR DELETE ON ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- 9. Tickets Table (QR Reference Hash)
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qr_hash TEXT UNIQUE NOT NULL, -- SHA-256 of random >=128-bit reference (Rule 02)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_qr_hash ON tickets(qr_hash);

-- 10. Record Migration in Ledger
INSERT INTO migrations_ledger (filename)
VALUES ('002_cinema_showtimes_payments.sql')
ON CONFLICT (filename) DO NOTHING;

