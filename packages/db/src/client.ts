import postgres from '@prisma/orm-postgres/runtime'
import { contractFromJson } from '@prisma/orm-postgres/static'
import { createPool, type Pool } from './pool'
import type { Contract } from './prisma/schema/contract'
import contractJson from './prisma/schema/contract.json' with { type: 'json' }

export const contract = contractFromJson<Contract>(contractJson)

export function createDb(pool: Pool) {
  return postgres({ contract, pg: pool })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

let sharedPoolInstance: Pool | undefined
let sharedDbInstance: Db | undefined

export function sharedPool(): Pool {
  if (sharedPoolInstance !== undefined) return sharedPoolInstance
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set — run through the env:inject script')
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
