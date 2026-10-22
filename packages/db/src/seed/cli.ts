import { createDb } from '../client'
import { createPool } from '../pool'
import { seed } from './seed'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function assertLocalTarget(connectionString: string | undefined): string {
  if (!connectionString) throw new Error('DATABASE_URL is not set — run through the env:inject script')
  const { hostname } = new URL(connectionString)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`the seed only runs against a local database; refusing ${hostname}`)
  }
  return connectionString
}

if (import.meta.main) {
  const pool = createPool(assertLocalTarget(process.env.DATABASE_URL))
  try {
    await seed(createDb(pool))
    console.log('seeded the dev user, a workspace with a member, a personal and a workspace project')
  } finally {
    await pool.end()
  }
}
