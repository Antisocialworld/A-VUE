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
});
