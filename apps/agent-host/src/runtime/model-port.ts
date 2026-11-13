import { findCard, toAccountId, type ModelChoice, type ModelPort } from '@dltech/atlas-core'
import type { RoleModelRequest } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { generatedCatalogue } from '@dltech/atlas-models'

import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import type { ModelSource, ResolvedRoleModel } from '../config/model-config'
import type { MediaSigner } from '../media/media-signer'
import { signerUrls } from '../media/media-urls'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { LiveModelPort } from '../model/live-model-port'
import { createProviderModel } from '../model/providers'
import type { ModelTokenService } from '../tokens/model-token-service'

type PortDeps = {
  userId: string
  tokens: Pick<ModelTokenService, 'issue'>
  media?: MediaSigner | undefined
  log?: LogPort | undefined
}

export type SessionModels = {
  main: ModelPort
  modelChoice(): ModelChoice
  modelFor(request: RoleModelRequest): ModelPort
  choiceFor(request: RoleModelRequest): ModelChoice
}

export const modelPortOf = (args: PortDeps & { resolved: ResolvedRoleModel }): AiSdkModelPort => {
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

const readFailureLogOf = (log: LogPort | undefined): ((error: unknown) => void) | undefined =>
  log === undefined
    ? undefined
    : (error) =>
        log.error({
          source: 'runtime.model-refresh',
          message: 'kept the current model after a failed config read',
          ...logFieldsOf({ error }),
        })

export const liveSessionModelsOf = (
  args: PortDeps & { initial: ModelSource; read: () => Promise<ModelSource> },
): SessionModels => {
  let latest = args.initial
  const refreshed = async (): Promise<ModelSource> => {
    latest = await args.read()
    return latest
  }
  const onReadFailure = readFailureLogOf(args.log)
  const liveFor = (pick: (source: ModelSource) => ResolvedRoleModel): ModelPort =>
    new LiveModelPort({
      initial: pick(latest),
      read: async () => pick(await refreshed()),
      build: (resolved) => modelPortOf({ ...args, resolved }),
      ...(onReadFailure === undefined ? {} : { onReadFailure }),
    })
  return {
    main: liveFor((source) => source.main),
    modelChoice: () => latest.main.choice,
    modelFor: (request) => liveFor((source) => source.resolve(request)),
    choiceFor: (request) => latest.resolve(request).choice,
  }
}

export const fixedSessionModelsOf = (args: {
  port: () => ModelPort
  source: ModelSource
}): SessionModels => ({
  main: args.port(),
  modelChoice: () => args.source.main.choice,
  modelFor: () => args.port(),
  choiceFor: () => args.source.main.choice,
})
