import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('A VUE Cinema & Showtimes Seed Script Audit (Rule 03 & 04, Task E)', () => {
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

  it('asserts seed script provisions 2 Lagos cinemas and 7 halls (3 seeded + 4 free/on-demand)', () => {
    expect(scriptSrc).toContain('A VUE Cinema Victoria Island');
    expect(scriptSrc).toContain('A VUE Cinema Ikeja City Mall');
    expect(scriptSrc).toContain("city: 'Lagos'");

    // Existing halls unchanged
    expect(scriptSrc).toContain("id: 'b0000001-0000-4000-8000-000000000001'");
    expect(scriptSrc).toContain("name: 'Screen 1 (Grand)'");
    expect(scriptSrc).toContain("id: 'b0000001-0000-4000-8000-000000000002'");
    expect(scriptSrc).toContain("name: 'Screen 2 (VIP)'");
    expect(scriptSrc).toContain("id: 'b0000002-0000-4000-8000-000000000001'");
    expect(scriptSrc).toContain("name: 'Screen 1 (Main)'");
    expect(scriptSrc).toContain("id: 'b0000002-0000-4000-8000-000000000002'");
    expect(scriptSrc).toContain("name: 'Screen 2 (Arena)'");

    // Exactly 3 seeded halls (VI Grand, VI VIP, Ikeja Main)
    expect(scriptSrc.match(/isSeeded: true/g) ?? []).toHaveLength(3);
    // Free halls include Arena + 3 new halls
    expect(scriptSrc.match(/isSeeded: false/g) ?? []).toHaveLength(4);

    // 3 new free halls with distinct names, attached to existing cinemas
    expect(scriptSrc).toContain("id: 'b0000001-0000-4000-8000-000000000003'");
    expect(scriptSrc).toContain("name: 'Screen 3 (Studio)'");
    expect(scriptSrc).toContain("cinemaId: SEED_CINEMAS[0].id");
    expect(scriptSrc).toContain("id: 'b0000001-0000-4000-8000-000000000004'");
    expect(scriptSrc).toContain("name: 'Screen 4 (Lounge)'");
    expect(scriptSrc).toContain("id: 'b0000002-0000-4000-8000-000000000003'");
    expect(scriptSrc).toContain("name: 'Screen 3 (Plaza)'");
    expect(scriptSrc).toContain("cinemaId: SEED_CINEMAS[1].id");

    // Distinct seat-map layouts (existing + 3 new)
    expect(scriptSrc).toContain('ROWS_80');
    expect(scriptSrc).toContain('ROWS_50');
    expect(scriptSrc).toContain('ROWS_60');
    expect(scriptSrc).toContain('ROWS_70');
    expect(scriptSrc).toContain('ROWS_40');
    expect(scriptSrc).toContain('totalSeats: 80');
    expect(scriptSrc).toContain('totalSeats: 70');
    expect(scriptSrc).toContain('totalSeats: 60');
    expect(scriptSrc).toContain('totalSeats: 50');
    expect(scriptSrc).toContain('totalSeats: 40');
    expect(scriptSrc).toContain('accessibleSeats');

    // Existing prices unchanged and new hall prices in existing range (₦3,000 to ₦4,500)
    expect(scriptSrc).toContain('priceKobo: 350000'); // Grand
    expect(scriptSrc).toContain('priceKobo: 450000'); // VIP
    expect(scriptSrc).toContain('priceKobo: 300000'); // Main
    expect(scriptSrc).toContain('priceKobo: 400000'); // Arena
    expect(scriptSrc).toContain('priceKobo: 320000'); // Studio (new)
    expect(scriptSrc).toContain('priceKobo: 420000'); // Lounge (new)
    expect(scriptSrc).toContain('priceKobo: 380000'); // Plaza (new)

    const newHallPriceMatches = Array.from(
      scriptSrc.matchAll(/priceKobo:\s*(\d+)/g),
      (m) => Number(m[1]),
    );
    expect(newHallPriceMatches.length).toBeGreaterThanOrEqual(7);
    for (const price of newHallPriceMatches) {
      expect(price).toBeGreaterThanOrEqual(300000);
      expect(price).toBeLessThanOrEqual(450000);
    }
  });

  it('asserts seed script populates both screens and halls tables for API compatibility', () => {
    expect(scriptSrc).toContain('INSERT INTO screens');
    expect(scriptSrc).toContain('INSERT INTO halls');
  });

  it('asserts the seed sets screens.price_kobo and screens.is_seeded idempotently for every hall', () => {
    const loopStart = scriptSrc.indexOf('for (const hall of SEED_HALLS)');
    const seatsSectionStart = scriptSrc.indexOf('// 3. Seed Seats');

    expect(loopStart).toBeGreaterThan(-1);
    expect(seatsSectionStart).toBeGreaterThan(loopStart);

    const screensSection = scriptSrc.slice(loopStart, seatsSectionStart);
    expect(screensSection).toContain('UPDATE screens');
    expect(screensSection).toContain('SET price_kobo = $2, is_seeded = $3');
    expect(screensSection).toContain('[hall.id, hall.priceKobo, hall.isSeeded]');
  });

  it('asserts seed script populates seats with both migration 001 and 002 column sets', () => {
    expect(scriptSrc).toContain('INSERT INTO seats');
    expect(scriptSrc).toContain(
      'screen_id, hall_id, row_label, "row", seat_number, "number", seat_type, accessible',
    );
  });

  it('asserts showtimes schedule uses Africa/Lagos timezone, is_seeded selection, and exit 0', () => {
    expect(scriptSrc).toContain('Africa/Lagos');
    expect(scriptSrc).toContain("'13:00', '16:30', '20:00'");
    expect(scriptSrc).toContain('selectSeededScreens(SEED_HALLS)');
    expect(scriptSrc).toContain('process.exit(0)');
  });
});
