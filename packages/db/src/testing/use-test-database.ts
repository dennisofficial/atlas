import { beforeAll, beforeEach } from 'bun:test'
import { db, type Db, sharedPool } from '../client'
import type { Pool } from '../pool'
import { ensureTestDatabase, truncateAll } from './test-database'

export type TestDatabase = { url: string; pool: Pool; db: Db }

export function useTestDatabase(): () => TestDatabase {
  beforeAll(ensureTestDatabase)
  beforeEach(truncateAll)
  return () => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL is unset')
    return { url, pool: sharedPool(), db }
  }
}
