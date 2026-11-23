import type { LanguageModelV4 } from '@ai-sdk/provider'
import { findCard, toAccountId, type ModelChoice, type ModelPort } from '@dltech/atlas-core'
import type { RoleModelChoice, RoleModelRequest } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort, type TracePort } from '@dltech/atlas-observability'
import { generatedCatalogue } from '@dltech/atlas-models'

import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import type { ModelSource, ResolvedRoleModel } from '../config/model-config'
import type { MediaSigner } from '../media/media-signer'
import { signerUrls } from '../media/media-urls'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { LiveModelPort } from '../model/live-model-port'
import type { FastRefusal } from '../model/providers/fast-fallback'
import { createProviderModel } from '../model/providers'
import type { ModelTokenService } from '../tokens/model-token-service'

type PortDeps = {
  userId: string
  tokens: Pick<ModelTokenService, 'issue'>
  media?: MediaSigner | undefined
  log?: LogPort | undefined
  trace?: TracePort | undefined
  onFastRefused?: ((refusal: FastRefusal) => Promise<void> | void) | undefined
}

export type SessionModels = {
  main: ModelPort
  modelChoice(): ModelChoice
  modelOf(choice: ModelChoice): ModelPort
  choiceFor(request: RoleModelRequest): RoleModelChoice
}

export const providerModelOf = (args: {
  userId: string
  tokens: Pick<ModelTokenService, 'issue'>
  resolved: ResolvedRoleModel
  onFastRefused?: ((refusal: FastRefusal) => Promise<void> | void) | undefined
}): LanguageModelV4 => {
  const { choice, config } = args.resolved
  return createProviderModel({
    ref: config.configured === true ? config.ref : choice.ref,
    credentials: new AgentHostCredentialPort({
      userId: args.userId,
      model: config,
      tokens: args.tokens,
    }),
    ...(config.configured === true ? { accountId: toAccountId(config.accountId) } : {}),
    effort: () => choice.effort,
    fast: () => choice.fast,
    ...(args.onFastRefused === undefined ? {} : { onFastRefused: args.onFastRefused }),
  })
}

export const modelPortOf = (args: PortDeps & { resolved: ResolvedRoleModel }): AiSdkModelPort => {
  const { choice, config } = args.resolved
  const ref = config.configured === true ? config.ref : choice.ref
  return new AiSdkModelPort({
    model: providerModelOf(args),
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

const readTimeoutLogOf = (
  log: LogPort | undefined,
): ((args: { timeoutMs: number }) => void) | undefined =>
  log === undefined
    ? undefined
    : ({ timeoutMs }) =>
        log.warn({
          source: 'runtime.model-refresh',
          message: `kept the current model after the config read passed ${timeoutMs} ms`,
        })

export const liveSessionModelsOf = (
  args: PortDeps & {
    initial: ModelSource
    read: () => Promise<ModelSource>
    trace?: TracePort | undefined
  },
): SessionModels => {
  let latest = args.initial
  const refreshed = async (): Promise<ModelSource> => {
    latest = await args.read()
    return latest
  }
  const onReadFailure = readFailureLogOf(args.log)
  const onReadTimeout = readTimeoutLogOf(args.log)
  const liveFor = (pick: (source: ModelSource) => ResolvedRoleModel): ModelPort =>
    new LiveModelPort({
      initial: pick(latest),
      read: async () => pick(await refreshed()),
      build: (resolved) => modelPortOf({ ...args, resolved }),
      ...(onReadFailure === undefined ? {} : { onReadFailure }),
      ...(onReadTimeout === undefined ? {} : { onReadTimeout }),
      ...(args.trace === undefined ? {} : { trace: args.trace }),
    })
  return {
    main: liveFor((source) => source.main),
    modelChoice: () => latest.main.choice,
    modelOf: (choice) => liveFor((source) => source.pinned(choice)),
    choiceFor: (request) => latest.resolve(request).choice,
  }
}

export const sessionModelsOf = (args: {
  override: ((args: { sessionId: string }) => ModelPort) | undefined
  sessionId: string
  userId: string
  initial: ModelSource
  read: () => Promise<ModelSource>
  tokens: Pick<ModelTokenService, 'issue'>
  media?: MediaSigner | undefined
  log?: LogPort | undefined
  trace?: TracePort | undefined
  onFastRefused?: ((refusal: FastRefusal) => Promise<void> | void) | undefined
}): SessionModels => {
  const override = args.override
  if (override === undefined) {
    return liveSessionModelsOf({
      userId: args.userId,
      initial: args.initial,
      read: args.read,
      tokens: args.tokens,
      media: args.media,
      log: args.log,
      ...(args.trace === undefined ? {} : { trace: args.trace }),
      onFastRefused: args.onFastRefused,
    })
  }
  return fixedSessionModelsOf({
    port: () => override({ sessionId: args.sessionId }),
    source: args.initial,
  })
}

export const fixedSessionModelsOf = (args: {
  port: () => ModelPort
  source: ModelSource
}): SessionModels => ({
  main: args.port(),
  modelChoice: () => args.source.main.choice,
  modelOf: () => args.port(),
  choiceFor: () => args.source.main.choice,
})
