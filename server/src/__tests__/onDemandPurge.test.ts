import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '../lib/db.js';
import { purgeStaleOnDemandShowtimes } from '../lib/jobs.js';

describe('On-demand showtime purge job', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs one bounded DELETE and returns the number of deleted rows', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;
    querySpy.mockResolvedValue({
      rows: [{ id: 'row-1' }, { id: 'row-2' }],
      rowCount: 2,
    });

    const deleted = await purgeStaleOnDemandShowtimes(50);

    expect(deleted).toBe(2);
    expect(querySpy).toHaveBeenCalledTimes(1);

    const [sql, params] = querySpy.mock.calls[0];
    expect(params).toEqual([50]);
    expect(sql).toContain('DELETE FROM showtimes');
    expect(sql).toContain('LIMIT $1');
  });

  it('never deletes seeded showtimes (only source = on_demand)', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;
    querySpy.mockResolvedValue({ rows: [], rowCount: 0 });

    await purgeStaleOnDemandShowtimes();

    const [sql] = querySpy.mock.calls[0];
    expect(sql).toContain("s.source = 'on_demand'");
    expect(sql).not.toContain("source <> 'on_demand'");
    expect(sql).not.toContain("source = 'seed'");
  });

  it('never deletes a showtime that has a booking or payment', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;
    querySpy.mockResolvedValue({ rows: [], rowCount: 0 });

    await purgeStaleOnDemandShowtimes();

    const [sql] = querySpy.mock.calls[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('FROM bookings b');
    expect(sql).toContain('b.showtime_id = s.id');
    expect(sql).toContain("INTERVAL '24 hours'");
  });

  it('only considers showtimes that started more than 24 hours ago', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;
    querySpy.mockResolvedValue({ rows: [], rowCount: 0 });

    await purgeStaleOnDemandShowtimes();

    const [sql] = querySpy.mock.calls[0];
    expect(sql).toMatch(/s\.starts_at\s*<\s*NOW\(\)\s*-\s*INTERVAL '24 hours'/);
  });

  it('defaults to a batch of 100 and is idempotent on re-run', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;
    querySpy
      .mockResolvedValueOnce({ rows: [{ id: 'row-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const first = await purgeStaleOnDemandShowtimes();
    const second = await purgeStaleOnDemandShowtimes();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(querySpy.mock.calls[0][1]).toEqual([100]);
    expect(querySpy.mock.calls[1][1]).toEqual([100]);
  });

  it('rejects an invalid batch size before touching the database', async () => {
    const querySpy = vi.spyOn(db.writerPool, 'query') as any;

    await expect(purgeStaleOnDemandShowtimes(0)).rejects.toThrow('INVALID_BATCH_SIZE');
    expect(querySpy).not.toHaveBeenCalled();
  });
});

describe('On-demand purge wiring and statements', () => {
  const jobsPath = path.resolve(__dirname, '../lib/jobs.ts');
  const cronPath = path.resolve(__dirname, '../routes/cron.ts');
  const jobsSrc = fs.readFileSync(jobsPath, 'utf-8');
  const cronSrc = fs.readFileSync(cronPath, 'utf-8');

  const purgeSection = jobsSrc.slice(
    jobsSrc.indexOf('export async function purgeStaleOnDemandShowtimes'),
  );

  it('is a single SQL statement inside one job function', () => {
    expect(purgeSection.length).toBeGreaterThan(0);
    expect(purgeSection.match(/DELETE FROM showtimes/g)).toHaveLength(1);
    expect(purgeSection.match(/pool\.query\(/g)).toHaveLength(1);
    expect(purgeSection.match(/writerPool\.connect\(/g)).toBeNull();
  });

  it('wires the purge into the existing /cron/purge-users handler', () => {
    expect(cronSrc).toContain('purgeStaleOnDemandShowtimes');
    expect(cronSrc).toContain('purgeStaleOnDemandShowtimes(100)');
    expect(cronSrc).toContain('showtimesPurged');
    expect(cronSrc).toContain("fastify.post('/cron/purge-users'");
  });

  it('does not add a second cron route for showtimes', () => {
    expect(cronSrc).not.toContain('/cron/purge-showtimes');
  });
});
