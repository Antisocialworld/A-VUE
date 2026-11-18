import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('A VUE Cinema & Showtimes Seed Script Audit (Rule 03 & 04)', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/seed-cinema.ts');
  const pkgPath = path.resolve(__dirname, '../../package.json');

  const scriptSrc = fs.readFileSync(scriptPath, 'utf-8');
  const pkgSrc = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgSrc);

  it('asserts the seed script exists at server/scripts/seed-cinema.ts', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('asserts "seed:cinema" is configured in server/package.json', () => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['seed:cinema']).toBe('tsx scripts/seed-cinema.ts');
  });

  it('asserts the seed script executes in a single database transaction', () => {
    expect(scriptSrc).toContain("'BEGIN'");
    expect(scriptSrc).toContain("'COMMIT'");
    expect(scriptSrc).toContain("'ROLLBACK'");
  });

  it('asserts the seed script enforces strict idempotency guards', () => {
    expect(scriptSrc).toContain('ON CONFLICT (id) DO NOTHING');
    expect(scriptSrc).toContain('ON CONFLICT (screen_id, row_label, seat_number) DO NOTHING');
    expect(scriptSrc).toContain('WHERE NOT EXISTS');
  });

  it('asserts Math.random is banned in the seed script', () => {
    expect(scriptSrc).not.toContain('Math.random');
  });

  it('asserts no connection strings, passwords, or credentials exist in the seed script', () => {
    expect(scriptSrc).not.toMatch(/postgres:\/\//i);
    expect(scriptSrc).not.toMatch(/redis:\/\//i);
    expect(scriptSrc).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
    expect(scriptSrc).not.toMatch(/bearer\s+/i);
  });

  it('asserts seed script provisions 2 Lagos cinemas and 4 halls (80-seat and 50-seat)', () => {
    expect(scriptSrc).toContain('A VUE Cinema Victoria Island');
    expect(scriptSrc).toContain('A VUE Cinema Ikeja City Mall');
    expect(scriptSrc).toContain('totalSeats: 80');
    expect(scriptSrc).toContain('totalSeats: 50');
    expect(scriptSrc).toContain('accessibleSeats');
    expect(scriptSrc).toContain("city: 'Lagos'");
  });

  it('asserts seed script populates both screens and halls tables for API compatibility', () => {
    expect(scriptSrc).toContain('INSERT INTO screens');
    expect(scriptSrc).toContain('INSERT INTO halls');
  });

  it('asserts the seed sets screens.price_kobo for every hall in SEED_HALLS', () => {
    const loopStart = scriptSrc.indexOf('for (const hall of SEED_HALLS)');
    const seatsSectionStart = scriptSrc.indexOf('// 3. Seed Seats');

    expect(loopStart).toBeGreaterThan(-1);
    expect(seatsSectionStart).toBeGreaterThan(loopStart);

    const screensSection = scriptSrc.slice(loopStart, seatsSectionStart);
    expect(screensSection).toContain('UPDATE screens');
    expect(screensSection).toContain('SET price_kobo = $2');
    expect(screensSection).toContain('[hall.id, hall.priceKobo]');
  });

  it('asserts seed script populates seats with both migration 001 and 002 column sets', () => {
    expect(scriptSrc).toContain('INSERT INTO seats');
    expect(scriptSrc).toContain('screen_id, hall_id, row_label, "row", seat_number, "number", seat_type, accessible');
  });

  it('asserts showtimes schedule uses Africa/Lagos timezone, integer kobo pricing, and exit 0', () => {
    expect(scriptSrc).toContain('Africa/Lagos');
    expect(scriptSrc).toContain("'13:00', '16:30', '20:00'");
    expect(scriptSrc).toContain('priceKobo: 350000');
    expect(scriptSrc).toContain('priceKobo: 450000');
    expect(scriptSrc).toContain('priceKobo: 300000');
    expect(scriptSrc).toContain('priceKobo: 400000');
    expect(scriptSrc).toContain('process.exit(0)');
  });
});
