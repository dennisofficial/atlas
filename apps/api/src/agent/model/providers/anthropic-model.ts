import type { LanguageModelV4 } from '@ai-sdk/provider'

import { createAnthropicOauthModel, type AnthropicFetch } from './anthropic-oauth'
import { anthropicThinkingOptions } from './anthropic-thinking'
import { withFastFallback } from './fast-fallback'
import { ANTHROPIC_FAST_OPTIONS, runsFast, withFastOptions } from './fast-options'
import type { ProviderModelArgs } from './model-args'

export function createAnthropicModel(args: ProviderModelArgs): LanguageModelV4 {
  const build = (fast: boolean): LanguageModelV4 =>
    createAnthropicOauthModel({
      credentials: args.credentials,
      modelId: args.modelId,
      accountId: args.accountId,
      ...(args.fetch === undefined ? {} : { fetch: args.fetch as AnthropicFetch }),
      providerOptions: () =>
        withFastOptions({
          options: anthropicThinkingOptions({ card: args.card, effort: args.effort() }),
          fast: ANTHROPIC_FAST_OPTIONS,
          enabled: fast,
        }),
    })

  if (args.card?.fast !== true) return build(false)
  return withFastFallback({
    build,
    requested: () => runsFast({ card: args.card, fast: args.fast }),
  })
}
