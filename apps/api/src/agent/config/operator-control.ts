import { createDb, createPool, type Db } from '@dltech/atlas-db'
import { postInboxEntryIn } from '@dltech/atlas-control/postgres'

import { OperatorRequestRegistry } from '../operator-input'
import { OperatorSessionStore } from '../operator-input/store'
import { databaseUrlWithTls } from './database-url'
import type { AgentHostEnv } from './env'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

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

export const operatorRequestRegistry = (
  env: Pick<AgentHostEnv, 'databaseUrl' | 'secretsEncryptionKey'>,
): OperatorRequestRegistry =>
  operatorRegistryOf({
    db: createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    ),
    cipher: new SecretCipher(env.secretsEncryptionKey),
  })
