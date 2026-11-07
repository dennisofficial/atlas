import type { LanguageModelV4 } from '@ai-sdk/provider'

import { OPENAI_FAST_OPTIONS, runsFast, withFastOptions } from './fast-options'
import type { ProviderModelArgs } from './model-args'
import { createOpenAiModel } from './openai-model'
import { openaiEffortOptions } from './openai-effort'

export const createOpenAiProviderModel = (args: ProviderModelArgs): LanguageModelV4 =>
  createOpenAiModel({
    credentials: args.credentials,
    modelId: args.modelId,
    accountId: args.accountId,
    ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    providerOptions: () =>
      withFastOptions({
        options: openaiEffortOptions({ card: args.card, effort: args.effort() }),
        fast: OPENAI_FAST_OPTIONS,
        enabled: runsFast({ card: args.card, fast: args.fast }),
      }),
  })
