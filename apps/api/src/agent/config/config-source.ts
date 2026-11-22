import type { Db } from '@dltech/atlas-db'

import type { ConfigSource } from './agent-host-config'
import { ConfigReader } from './config-reader'
import type { PodsEnv } from '@dltech/atlas-pods/env'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

export type ConfigSourceEnv = Pick<PodsEnv, 'platformVercel' | 'agent37'>

export const configSourceOf = (args: {
  env: ConfigSourceEnv
  db: Db
  cipher: SecretCipher
}): ConfigSource =>
  new ConfigReader({
    db: args.db,
    cipher: args.cipher,
    platform: { platformVercel: args.env.platformVercel, agent37: args.env.agent37 },
  })
