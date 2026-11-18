import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Database Migrations & Ledger Schema Audit (Rule 03)', () => {
  // Correct relative path: from server/src/__tests__ to server/migrations (2 levels up)
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  it('contains forward-only numbered SQL files in server/migrations', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(file).toMatch(/^\d{3}_[\w-]+\.sql$/);
    }
  });

  it('defines migrations_ledger and records applied migration', () => {
    const migration001 = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8');
    expect(migration001).toContain('CREATE TABLE IF NOT EXISTS migrations_ledger');
    expect(migration001).toContain("INSERT INTO migrations_ledger (filename)");
  });

  it('stores all currency as integer kobo (BIGINT)', () => {
    const migration001 = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8');
    expect(migration001).toContain('price_kobo BIGINT NOT NULL');
    expect(migration001).toContain('amount_kobo BIGINT NOT NULL');
    expect(migration001).not.toContain('NUMERIC');
    expect(migration001).not.toContain('DECIMAL');
    expect(migration001).not.toContain('FLOAT');
  });

  it('enforces UNIQUE(showtime_id, seat_id) constraint on bookings table', () => {
    const migration001 = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8');
    expect(migration001).toContain('uq_bookings_showtime_seat UNIQUE (showtime_id, seat_id)');
  });

  it('enforces database trigger preventing mutation on refund_ledger (append-only)', () => {
    const migration001 = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8');
    expect(migration001).toContain('CREATE TRIGGER trg_refund_ledger_immutable');
    expect(migration001).toContain('BEFORE UPDATE OR DELETE ON refund_ledger');
    expect(migration001).toContain('refund_ledger is append-only');
  });

  it('configures pg_trgm GIN index on cinemas for fuzzy search', () => {
    const migration001 = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8');
    expect(migration001).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect(migration001).toContain('USING gin (name gin_trgm_ops)');
  });

  describe('Migration 002: Showtimes, Seats, Payments & Ledger (Task 2)', () => {
    const migration002Path = path.join(migrationsDir, '002_cinema_showtimes_payments.sql');

    it('migration 002 file exists and is forward-only', () => {
      expect(fs.existsSync(migration002Path)).toBe(true);
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain("INSERT INTO migrations_ledger (filename)");
      expect(sql).toContain("'002_cinema_showtimes_payments.sql'");
      expect(sql).not.toMatch(/\bDROP TABLE\b/i);
    });

    it('adds accessible boolean, row, and number to seats', () => {
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain('accessible BOOLEAN NOT NULL DEFAULT false');
      expect(sql).toContain('"row" TEXT');
      expect(sql).toContain('"number" INT');
    });

    it('adds cancelled_at to showtimes', () => {
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain('cancelled_at TIMESTAMPTZ');
    });

    it('enforces unique constraints on bookings and payments', () => {
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain('uq_bookings_showtime_seat');
      expect(sql).toContain('uq_payments_user_idempotency');
      expect(sql).toContain('uq_idempotency_user_route_key UNIQUE (user_id, route, key)');
    });

    it('enforces append-only database trigger on general ledger table', () => {
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS ledger');
      expect(sql).toContain('CREATE TRIGGER trg_ledger_immutable');
      expect(sql).toContain('BEFORE UPDATE OR DELETE ON ledger');
      expect(sql).toContain('ledger is strictly append-only');
    });

    it('creates tickets table with SHA-256 qr_hash', () => {
      const sql = fs.readFileSync(migration002Path, 'utf-8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS tickets');
      expect(sql).toContain('qr_hash TEXT UNIQUE NOT NULL');
    });
  });

  describe('Migration 006: On-Demand Showtimes (Task 1)', () => {
    const migration006Path = path.join(migrationsDir, '006_showtimes_on_demand.sql');

    it('migration 006 file exists, is forward-only, and contains no DROP or DELETE', () => {
      expect(fs.existsSync(migration006Path)).toBe(true);
      const sql = fs.readFileSync(migration006Path, 'utf-8');
      expect(sql).toContain("INSERT INTO migrations_ledger (filename)");
      expect(sql).toContain("'006_showtimes_on_demand.sql'");
      expect(sql).not.toMatch(/\bDROP\b/i);
      expect(sql).not.toMatch(/\bDELETE\b/i);
    });

    it('contains CHECK constraint on source column (seed | on_demand)', () => {
      const sql = fs.readFileSync(migration006Path, 'utf-8');
      expect(sql).toContain("source TEXT NOT NULL DEFAULT 'seed'");
      expect(sql).toContain("CHECK (source IN ('seed', 'on_demand'))");
    });

    it('contains UNIQUE index on (screen_id, starts_at)', () => {
      const sql = fs.readFileSync(migration006Path, 'utf-8');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
      expect(sql).toContain('(screen_id, starts_at)');
    });

    it('adds created_at only if missing', () => {
      const sql = fs.readFileSync(migration006Path, 'utf-8');
      expect(sql).toContain('ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ');
    });

    it('includes pre-flight duplicate check query in comments', () => {
      const sql = fs.readFileSync(migration006Path, 'utf-8');
      expect(sql).toContain('SELECT screen_id, starts_at');
      expect(sql).toContain('HAVING COUNT(*) > 1');
    });
  });

  describe('Migration 007: Screen Prices (Task P)', () => {
    const migration007Path = path.join(migrationsDir, '007_screens_price.sql');

    it('migration 007 file exists, is forward-only, and contains no DROP or DELETE', () => {
      expect(fs.existsSync(migration007Path)).toBe(true);
      const sql = fs.readFileSync(migration007Path, 'utf-8');
      expect(sql).toContain("INSERT INTO migrations_ledger (filename)");
      expect(sql).toContain("'007_screens_price.sql'");
      expect(sql).toContain('ON CONFLICT (filename) DO NOTHING');
      expect(sql).not.toMatch(/\bDROP\b/i);
      expect(sql).not.toMatch(/\bDELETE\b/i);
    });

    it('adds price_kobo with the same BIGINT type as showtimes.price_kobo, only if missing', () => {
      const sql = fs.readFileSync(migration007Path, 'utf-8');
      expect(sql).toContain('ALTER TABLE screens ADD COLUMN IF NOT EXISTS price_kobo BIGINT');
      expect(sql).not.toContain('ADD COLUMN IF NOT EXISTS price_kobo BIGINT NOT NULL');
    });

    it('adds a guarded CHECK for positive kobo or NULL', () => {
      const sql = fs.readFileSync(migration007Path, 'utf-8');
      expect(sql).toContain('IF NOT EXISTS (');
      expect(sql).toContain("SELECT 1 FROM pg_constraint WHERE conname = 'screens_price_kobo_check'");
      expect(sql).toContain('ADD CONSTRAINT screens_price_kobo_check');
      expect(sql).toContain('CHECK (price_kobo IS NULL OR price_kobo > 0)');
    });

    it('backfills NULL prices from the latest showtime per screen', () => {
      const sql = fs.readFileSync(migration007Path, 'utf-8');
      expect(sql).toContain('UPDATE screens s');
      expect(sql).toContain('SET price_kobo = (');
      expect(sql).toContain('SELECT st.price_kobo');
      expect(sql).toContain('WHERE st.screen_id = s.id');
      expect(sql).toContain('ORDER BY st.starts_at DESC');
      expect(sql).toContain('LIMIT 1');
      expect(sql).toContain('WHERE s.price_kobo IS NULL');
    });
  });

  describe('Migration 008: Screen Seed Flag (Task E1)', () => {
    const migration008Path = path.join(migrationsDir, '008_screens_is_seeded.sql');

    it('migration 008 file exists, is forward-only, and records in ledger', () => {
      expect(fs.existsSync(migration008Path)).toBe(true);
      const sql = fs.readFileSync(migration008Path, 'utf-8');
      expect(sql).toContain("INSERT INTO migrations_ledger (filename)");
      expect(sql).toContain("'008_screens_is_seeded.sql'");
      expect(sql).toContain('ON CONFLICT (filename) DO NOTHING');
      expect(sql).not.toMatch(/\bDROP\b/i);
      expect(sql).not.toMatch(/\bDELETE\b/i);
    });

    it('adds is_seeded boolean NOT NULL DEFAULT false (idempotent)', () => {
      const sql = fs.readFileSync(migration008Path, 'utf-8');
      expect(sql).toContain(
        'ALTER TABLE screens ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT false',
      );
    });

    it('backfills true for exactly VI Grand, VI VIP and Ikeja Main by explicit ids', () => {
      const sql = fs.readFileSync(migration008Path, 'utf-8');
      const sqlNoComments = sql.replace(/--.*$/gm, '');
      expect(sql).toContain('UPDATE screens');
      expect(sql).toContain('SET is_seeded = true');
      expect(sql).toContain('WHERE id IN (');
      expect(sql).toContain("'b0000001-0000-4000-8000-000000000001'");
      expect(sql).toContain("'b0000001-0000-4000-8000-000000000002'");
      expect(sql).toContain("'b0000002-0000-4000-8000-000000000001'");
      expect(sqlNoComments).not.toContain('ORDER BY');
      expect(sqlNoComments).not.toContain('LIMIT');
    });
  });
});
