import pg from 'pg'

export type Pool = pg.Pool

const DEFAULT_POOL_MAX = 10
const IDLE_TIMEOUT_MS = 5_000

export function poolMaxOf(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX
}

function evictDeadOnCheckout(pool: pg.Pool): pg.Pool['connect'] {
  const connect = pool.connect.bind(pool)
  const acquire = async (): Promise<pg.PoolClient> => {
    for (;;) {
      const client = await connect()
      if (!client.connection.stream.destroyed) return client
      client.release(new Error('pooled connection lost its socket'))
    }
  }
  function guarded(): Promise<pg.PoolClient>
  function guarded(
    callback: (
      error: Error | undefined,
      client?: pg.PoolClient,
      release?: (error?: Error | boolean) => void,
    ) => void,
  ): void
  function guarded(
    callback?: (
      error: Error | undefined,
      client?: pg.PoolClient,
      release?: (error?: Error | boolean) => void,
    ) => void,
  ): Promise<pg.PoolClient> | undefined {
    const acquired = acquire()
    if (callback === undefined) return acquired
    acquired.then(
      (client) => callback(undefined, client, (error) => client.release(error)),
      (error: Error) => callback(error),
    )
    return undefined
  }
  return guarded
}

export type PoolOptions = {
  queryTimeoutMs?: number
}

export function createPool(connectionString: string, options?: PoolOptions): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: poolMaxOf(process.env.DATABASE_POOL_MAX),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 1_000,
    query_timeout: options?.queryTimeoutMs,
  })
  pool.connect = evictDeadOnCheckout(pool)
  pool.on('error', (error) => {
    console.error('database pool idle connection failed', error.message)
  })
  return pool
}
