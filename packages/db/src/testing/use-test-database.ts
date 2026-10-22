import { beforeAll, beforeEach } from 'bun:test'
import { db, type Db, sharedPool } from '../client'
import type { Pool } from '../pool'
import { ensureTestDatabase, truncateAll } from './test-database'

export type TestDatabase = { url: string; pool: Pool; db: Db }

const COLD_TEMPLATE_BUILD_TIMEOUT_MS = 120_000

export function useTestDatabase(): () => TestDatabase {
  beforeAll(ensureTestDatabase, { timeout: COLD_TEMPLATE_BUILD_TIMEOUT_MS })
  beforeEach(truncateAll)
  return () => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL is unset')
    return { url, pool: sharedPool(), db }
  }
}
