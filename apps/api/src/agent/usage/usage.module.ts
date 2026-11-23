import { Global, Module, type Provider } from '@nestjs/common'
import { CODEX_VERSION } from '@dltech/atlas-models'
import type { Db } from '@dltech/atlas-db'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { CLAUDE_CODE_VERSION } from '../model/providers/anthropic-subscription-attribution'
import { CIPHER, DB, MODEL_TOKENS, USAGE } from '../host/tokens'
import { RuntimeModule } from '../host/runtime.module'
import type { ModelTokenService } from '../tokens/model-token-service'
import { prismaUsageAccounts } from './usage-accounts'
import { UsageService } from './usage-service'

const usageProvider: Provider = {
  provide: USAGE,
  useFactory: (db: Db, cipher: SecretCipher, tokens: ModelTokenService): UsageService =>
    new UsageService({
      accounts: prismaUsageAccounts({ db }),
      tokens,
      cipher,
      clientVersions: { anthropic: CLAUDE_CODE_VERSION, codex: CODEX_VERSION },
    }),
  inject: [DB, CIPHER, MODEL_TOKENS],
}

@Global()
@Module({
  imports: [RuntimeModule],
  providers: [usageProvider],
  exports: [USAGE],
})
export class UsageModule {}
