import type { Db } from '@dltech/atlas-db'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import type { AgentHostEnv } from '../config/env'
import { BrowserReturnService } from './service'

export const WEB_ORIGIN_FALLBACK = 'https://byatlas.io'

export const browserReturnsOf = (args: {
  db: Db
  cipher: SecretCipher
  env: Pick<AgentHostEnv, 'publicUrl' | 'trustedOrigins'>
}): BrowserReturnService =>
  new BrowserReturnService({
    db: args.db,
    cipher: args.cipher,
    publicUrl: args.env.publicUrl,
    webOrigin: args.env.trustedOrigins[0] ?? WEB_ORIGIN_FALLBACK,
  })
