import pg from 'pg'

export type Pool = pg.Pool

const DEFAULT_POOL_MAX = 3
const IDLE_TIMEOUT_MS = 5_000

export function poolMaxOf(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX
}

export function createPool(connectionString: string): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: poolMaxOf(process.env.DATABASE_POOL_MAX),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  })
  pool.on('error', (error) => {
    console.error('database pool idle connection failed', error.message)
  })
  return pool
}
