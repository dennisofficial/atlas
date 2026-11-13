import {
  DEFAULT_EFFORT,
  findCard,
  toAccountId,
  type ModelPort,
  type ModelRef,
} from '@dltech/atlas-core'
import { generatedCatalogue } from '@dltech/atlas-models'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { ModelConfig } from '../config/agent-host-config'
import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { LiveModelPort } from '../model/live-model-port'
import { createProviderModel } from '../model/providers'
import type { MediaSigner } from '../media/media-signer'
import { signerUrls } from '../media/media-urls'
import type { ModelTokenService } from '../tokens/model-token-service'

const UNCONFIGURED_REF: ModelRef = {
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-5',
}

export const sessionModelPort = (args: {
  userId: string
  initial: ModelConfig
  read: () => Promise<ModelConfig>
  tokens: Pick<ModelTokenService, 'issue'>
  media?: MediaSigner | undefined
  log?: LogPort | undefined
}): ModelPort => {
  const build = (config: ModelConfig): AiSdkModelPort => {
    const chosen = config.configured === true ? config : undefined
    const ref = chosen?.ref ?? UNCONFIGURED_REF
    return new AiSdkModelPort({
      model: createProviderModel({
        ref,
        credentials: new AgentHostCredentialPort({
          userId: args.userId,
          model: config,
          tokens: args.tokens,
        }),
        ...(chosen === undefined ? {} : { accountId: toAccountId(chosen.accountId) }),
        effort: () => chosen?.effort ?? DEFAULT_EFFORT,
        fast: () => chosen?.fast ?? false,
      }),
      card: () => findCard({ catalog: generatedCatalogue(), ref }),
      ...(args.log === undefined ? {} : { log: args.log }),
      mediaSource:
        args.media === undefined
          ? undefined
          : signerUrls({ signer: args.media, userId: args.userId }),
    })
  }
  return new LiveModelPort({
    initial: args.initial,
    read: args.read,
    build,
    ...(args.log === undefined
      ? {}
      : {
          onReadFailure: (error: unknown) =>
            args.log?.error({
              source: 'runtime.model-refresh',
              message: 'kept the current model after a failed config read',
              ...logFieldsOf({ error }),
            }),
        }),
  })
}
