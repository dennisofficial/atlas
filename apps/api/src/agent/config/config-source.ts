import type { Db } from '@dltech/atlas-db'

import type { ConfigSource } from './agent-host-config'
import { ConfigReader } from './config-reader'
import type { AgentHostEnv } from './env'
import type { SecretCipher } from './secret-cipher'

export type ConfigSourceEnv = Pick<AgentHostEnv, 'platformVercel' | 'agent37'>

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
