import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'
import type { OperatorRequestPort } from '@dltech/atlas-host'

import {
  OperatorRequestRegistry,
  operatorRequestPortOf,
  type OperatorRegistryTimers,
} from '../operator-input'
import { OperatorSessionStore } from '../operator-input/store'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

export type OperatorControlPort = { of(sessionId: string): OperatorRequestPort }

export const operatorRegistryOf = (args: {
  db: Db
  answerTimeoutMs?: number | undefined
  now?: (() => number) | undefined
  timers?: OperatorRegistryTimers | undefined
}): OperatorRequestRegistry => {
  const store = new OperatorSessionStore(args.db)
  return new OperatorRequestRegistry({
    store,
    post: postInboxEntryIn,
    withTx: (run) => args.db.transaction(run),
    ...(args.answerTimeoutMs === undefined ? {} : { answerTimeoutMs: args.answerTimeoutMs }),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.timers === undefined ? {} : { timers: args.timers }),
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
