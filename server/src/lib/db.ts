/**
 * PostgreSQL Database Adapter (plain pg)
 * Rule 03: Neon pool max 1-2 per instance for serverless PgBouncer compatibility.
 * Writer pool + reader pool (reader falls back to writer).
 */

import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;

export const writerPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 2, // Strict serverless limit: max 1-2 per instance
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

export const readerPool = env.DATABASE_READ_URL
  ? new Pool({
      connectionString: env.DATABASE_READ_URL,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    })
  : writerPool;

export async function checkDbHealth(): Promise<boolean> {
  try {
    const result = await writerPool.query('SELECT 1 AS ok');
    return result.rows?.[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
  useWriter: boolean = true,
): Promise<pg.QueryResult<T>> {
  const pool = useWriter ? writerPool : readerPool;
  return pool.query<T>(text, params);
}

