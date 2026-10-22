import pg from 'pg'

export type Pool = pg.Pool

export function createPool(connectionString: string): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  })
  pool.on('error', (error) => {
    console.error('database pool idle connection failed', error.message)
  })
  return pool
}
