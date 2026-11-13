import { findCard, toAccountId, type ModelPort } from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'
import { generatedCatalogue } from '@dltech/atlas-models'

import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import type { ResolvedRoleModel } from '../config/model-config'
import type { MediaSigner } from '../media/media-signer'
import { signerUrls } from '../media/media-urls'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { createProviderModel } from '../model/providers'
import type { ModelTokenService } from '../tokens/model-token-service'

export const modelPortOf = (args: {
  userId: string
  resolved: ResolvedRoleModel
  tokens: Pick<ModelTokenService, 'issue'>
  media?: MediaSigner | undefined
  log?: LogPort | undefined
}): ModelPort => {
  const { choice, config } = args.resolved
  const ref = config.configured === true ? config.ref : choice.ref
  return new AiSdkModelPort({
    model: createProviderModel({
      ref,
      credentials: new AgentHostCredentialPort({
        userId: args.userId,
        model: config,
        tokens: args.tokens,
      }),
      ...(config.configured === true ? { accountId: toAccountId(config.accountId) } : {}),
      effort: () => choice.effort,
      fast: () => choice.fast,
    }),
    card: () => findCard({ catalog: generatedCatalogue(), ref }),
    ...(args.log === undefined ? {} : { log: args.log }),
    mediaSource:
      args.media === undefined
        ? undefined
        : signerUrls({ signer: args.media, userId: args.userId }),
  })
}
