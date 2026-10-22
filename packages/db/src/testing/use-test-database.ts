import { afterAll, beforeAll, beforeEach } from 'vitest'
import { closeSharedDb } from '../client'
import { createTestDatabase, type TestDatabase } from './test-database'

export function useTestDatabase(): () => TestDatabase {
  let current: TestDatabase | undefined
  beforeAll(async () => {
    current = await createTestDatabase()
    process.env.DATABASE_URL = current.url
  })
  beforeEach(async () => {
    await current?.truncate()
  })
  afterAll(async () => {
    await closeSharedDb()
    await current?.drop()
  })
  return () => {
    if (current === undefined) throw new Error('useTestDatabase() is read inside a test, after beforeAll')
    return current
  }
}
