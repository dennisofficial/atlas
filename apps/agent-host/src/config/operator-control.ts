import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'

import { OperatorRequestRegistry } from '../operator-input'
import { OperatorSessionStore } from '../operator-input/store'
import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { SecretCipher } from './secret-cipher'

const QUERY_TIMEOUT_MS = 10_000

export const operatorRegistryOf = (args: {
  db: Db
  cipher: SecretCipher
  now?: (() => number) | undefined
}): OperatorRequestRegistry => {
  const store = new OperatorSessionStore(args.db)
  return new OperatorRequestRegistry({
    store,
    post: postInboxEntryIn,
    withTx: (run) => args.db.transaction(run),
    seal: (value) => args.cipher.encrypt(value),
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
    registry = operatorRegistryOf({
      db,
      cipher: new SecretCipher(env.secretsEncryptionKey),
    })
  }
  return registry
}
