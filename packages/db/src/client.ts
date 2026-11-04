import postgres from '@prisma/orm-postgres/runtime'
import { contractFromJson } from '@prisma/orm-postgres/static'
import { createPool, poolMaxOf, type Pool } from './pool'
import type { Contract } from './prisma/schema/contract'
import contractJson from './prisma/schema/contract.json' with { type: 'json' }

export const contract = contractFromJson<Contract>(contractJson)

const CONNECTION_TERMINATED = 'Connection terminated'
const COMMIT_FAILED = 'Transaction commit failed'

function isRetryableConnectionLoss(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.includes(COMMIT_FAILED)) return false
  if (error.message.includes(CONNECTION_TERMINATED)) return true
  return error.cause instanceof Error && error.cause.message.includes(CONNECTION_TERMINATED)
}

export function createDb(pool: Pool) {
  const inner = postgres({ contract, pg: pool })
  return new Proxy(inner, {
    get(target, property) {
      if (property !== 'transaction') {
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return async <R>(fn: Parameters<typeof target.transaction>[0]): Promise<R> => {
        const attempts = poolMaxOf(process.env.DATABASE_POOL_MAX)
        let lastError: unknown
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            return (await target.transaction(fn)) as R
          } catch (error) {
            if (!isRetryableConnectionLoss(error)) throw error
            lastError = error
          }
        }
        throw lastError
      }
    },
  })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

let sharedPoolInstance: Pool | undefined
let sharedDbInstance: Db | undefined

export function sharedPool(): Pool {
  if (sharedPoolInstance !== undefined) return sharedPoolInstance
  const connectionString = process.env.DATABASE_URL
  if (!connectionString)
    throw new Error('DATABASE_URL is not set — run through the env:inject script')
  sharedPoolInstance = createPool(connectionString)
  return sharedPoolInstance
}

function sharedDb(): Db {
  sharedDbInstance ??= createDb(sharedPool())
  return sharedDbInstance
}

export async function closeSharedDb(): Promise<void> {
  const pool = sharedPoolInstance
  sharedDbInstance = undefined
  sharedPoolInstance = undefined
  await pool?.end()
}

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const instance = sharedDb()
    const value: unknown = Reflect.get(instance, property, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export const contractStorageHash: string = contractJson.storage.storageHash
