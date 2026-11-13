import { createDb, createPool, type Db } from '@dltech/atlas-db'
import type { OperatorRequestPort } from '@dltech/atlas-host'

import { OperatorRequestRegistry, operatorRequestPortOf } from '../operator-input'
import { OperatorRequestStore } from '../operator-input/store'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

export type OperatorControlPort = { of(sessionId: string): OperatorRequestPort }

export const operatorRegistryOf = (args: {
  db: Db
  ttlMs?: number | undefined
  now?: (() => number) | undefined
}): OperatorRequestRegistry => {
  const store = new OperatorRequestStore(args.db)
  return new OperatorRequestRegistry({
    store,
    ...(args.ttlMs === undefined ? {} : { ttlMs: args.ttlMs }),
    ...(args.now === undefined ? {} : { now: args.now }),
  })
}

let registry: OperatorRequestRegistry | undefined

export const operatorRequestRegistry = (): OperatorRequestRegistry => {
  if (registry === undefined) {
    const env = readAgentHostEnv()
    const db = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    registry = operatorRegistryOf({ db })
  }
  return registry
}

export const operatorControlPort = (): OperatorControlPort => ({
  of: () => operatorRequestPortOf(operatorRequestRegistry()),
})
