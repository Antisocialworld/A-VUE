/**
 * A VUE Database Seed Script (Not Applied Unasked - Run by Owner)
 * Seeds:
 * 1. 2 cinemas (Lagos City, Victoria Island)
 * 2. Grand Hall with 360 seats (>=320) including wheelchair-accessible seats in front rows
 * 3. Showtimes for the next 7 days for movie IDs passed as CLI arguments
 * Usage: npx tsx scripts/seed.ts [movie_id_1] [movie_id_2] ...
 */

import { writerPool } from '../src/lib/db.js';

async function seed() {
  const pool = writerPool;
  const args = process.argv.slice(2);
  const movieIds = args.length > 0 ? args : ['550', '27205']; // Default TMDB movie IDs if none provided

  console.log(`[Seed] Starting A VUE database seed for ${movieIds.length} movie(s)...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed 2 Cinemas
    const cinema1Res = await client.query(
      `INSERT INTO cinemas (name, city, address)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['A VUE Lagos City Cinema', 'Lagos', '14 Marina Boulevard, Lagos Island']
    );
    const cinema1Id = cinema1Res.rows[0].id;

    const cinema2Res = await client.query(
      `INSERT INTO cinemas (name, city, address)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['A VUE Victoria Island Cinema', 'Lagos', '32 Adeola Odeku St, Victoria Island']
    );
    const cinema2Id = cinema2Res.rows[0].id;

    // 2. Seed Grand Hall with 360 seats (18 rows of 20 seats) in Cinema 1
    const screenRes = await client.query(
      `INSERT INTO screens (cinema_id, name, total_seats)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [cinema1Id, 'Grand Horizon Screen 1', 360]
    );
    const screenId = screenRes.rows[0].id;

    // Also populate halls table for compatibility
    await client.query(
      `INSERT INTO halls (id, cinema_id, name, total_seats)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [screenId, cinema1Id, 'Grand Horizon Screen 1', 360]
    );

    // 3. Seed 360 Seats (Rows A-R, 20 seats per row)
    // Rows A-B (40 seats): wheelchair accessible
    // Rows C-P (280 seats): standard
    // Rows Q-R (40 seats): VIP
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];
    let seatCount = 0;

    for (const row of rows) {
      const isWheelchair = row === 'A' || row === 'B';
      const isVip = row === 'Q' || row === 'R';
      const seatType = isWheelchair ? 'wheelchair' : isVip ? 'vip' : 'standard';

      for (let num = 1; num <= 20; num++) {
        await client.query(
          `INSERT INTO seats (screen_id, hall_id, row_label, seat_number, "row", "number", accessible, seat_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (screen_id, row_label, seat_number) DO NOTHING`,
          [screenId, screenId, row, num, row, num, isWheelchair, seatType]
        );
        seatCount++;
      }
    }
    console.log(`[Seed] Seeded ${seatCount} seats in Grand Horizon Screen 1 (including 40 wheelchair-accessible seats).`);

    // 4. Seed Showtimes for the next 7 days
    const slotHours = [13, 16, 20]; // 1:00 PM, 4:30 PM, 8:00 PM
    let showtimeCount = 0;

    for (const movieId of movieIds) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (const hour of slotHours) {
          const startTime = new Date();
          startTime.setDate(startTime.getDate() + dayOffset);
          startTime.setHours(hour, hour === 16 ? 30 : 0, 0, 0);

          const priceKobo = hour === 20 ? 450000n : 350000n; // 4,500 NGN evening, 3,500 NGN matinee

          await client.query(
            `INSERT INTO showtimes (movie_id, screen_id, hall_id, starts_at, price_kobo)
             VALUES ($1, $2, $3, $4, $5)`,
            [movieId, screenId, screenId, startTime, priceKobo]
          );
          showtimeCount++;
        }
      }
    }
    console.log(`[Seed] Seeded ${showtimeCount} showtimes across next 7 days for movie IDs: ${movieIds.join(', ')}.`);

    await client.query('COMMIT');
    console.log('[Seed] Database seed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed Error] Failed to seed database:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { seed };

