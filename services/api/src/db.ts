import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { logger } from './logger.js';

/**
 * Thin typed query layer over a single pg Pool.
 *
 * The pool is created lazily and does NOT connect at construction time, so the
 * service (and tests / `tsc`) never require a running database to import this
 * module. The first query establishes a connection.
 */

let pool: Pool | null = null;

export function initDb(databaseUrl: string): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    logger.error({ err }, 'unexpected idle pg client error');
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized — call initDb() first');
  }
  return pool;
}

/** Run a parameterized query and return the typed rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const res = await getPool().query<T>(text, params as unknown[]);
  const ms = Date.now() - start;
  if (ms > 250) {
    logger.warn({ ms, text: text.slice(0, 120) }, 'slow query');
  }
  return res;
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const res = await query<T>(text, params);
  return res.rows[0] ?? null;
}

/** Run a function inside a transaction; rolls back on throw. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Build a parameterized `SET` clause for partial updates.
 * Returns the SQL fragment plus the ordered params, starting at $startIndex.
 * Keys must be trusted column names (callers pass a fixed allow-list).
 */
export function buildUpdateSet(
  data: Record<string, unknown>,
  startIndex = 1,
): { clause: string; params: unknown[] } {
  const cols = Object.keys(data);
  const params: unknown[] = [];
  const fragments = cols.map((col, i) => {
    params.push(data[col]);
    return `${col} = $${startIndex + i}`;
  });
  return { clause: fragments.join(', '), params };
}
