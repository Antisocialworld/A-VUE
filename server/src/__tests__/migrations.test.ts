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
});
