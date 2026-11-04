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

// pg's query_timeout rejects the hung query but keeps the deaf connection; pg-pool then hands
// the same client to the next waiter (acquire is LIFO), so the pool never recovers from a
// half-open link. Ending the client makes pg-pool remove it on release.
// https://github.com/brianc/node-postgres/blob/pg@8.22.0/packages/pg/lib/client.js#L660
class TimeoutDiscardingClient extends pg.Client {
  override query<T extends pg.Submittable>(queryStream: T): T
  override query<R extends any[] = any[], I = any[]>(
    queryConfig: pg.QueryArrayConfig<I>,
    values?: pg.QueryConfigValues<I>,
  ): Promise<pg.QueryArrayResult<R>>
  override query<R extends pg.QueryResultRow = any, I = any>(
    queryConfig: pg.QueryConfig<I>,
  ): Promise<pg.QueryResult<R>>
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    values?: pg.QueryConfigValues<I>,
  ): Promise<pg.QueryResult<R>>
  override query<R extends any[] = any[], I = any[]>(
    queryConfig: pg.QueryArrayConfig<I>,
    callback: (err: Error, result: pg.QueryArrayResult<R>) => void,
  ): void
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | pg.QueryConfig<I>,
    callback: (err: Error, result: pg.QueryResult<R>) => void,
  ): void
  override query<R extends pg.QueryResultRow = any, I = any[]>(
    queryText: string,
    values: pg.QueryConfigValues<I>,
    callback: (err: Error, result: pg.QueryResult<R>) => void,
  ): void
  override query(...args: unknown[]): unknown {
    const result: unknown = Reflect.apply(super.query, this, args)
    if (result instanceof Promise) {
      return result.catch((error: unknown) => this.discardAfterTimeout(error))
    }
    return result
  }

  private discardAfterTimeout(error: unknown): never {
    if (error instanceof Error && error.message === 'Query read timeout') void this.end()
    throw error
  }
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
    ...(options?.queryTimeoutMs === undefined ? {} : { Client: TimeoutDiscardingClient }),
  })
  pool.connect = evictDeadOnCheckout(pool)
  pool.on('error', (error) => {
    console.error('database pool idle connection failed', error.message)
  })
  return pool
}
