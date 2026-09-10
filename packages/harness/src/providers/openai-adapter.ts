import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import type { OpenAIProviderSettings } from '@ai-sdk/openai'

import { ProviderAdapter } from './adapter'
import { openaiEffortOptions } from './openai-effort'
import { createOpenAiModel, mergedProviderOptions } from './openai-oauth'

export const OPENAI_PROVIDER_ID = 'openai'

export class OpenAiAdapter extends ProviderAdapter {
  readonly id = OPENAI_PROVIDER_ID
  readonly label = 'Codex Plan'

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly fetch: OpenAIProviderSettings['fetch'] | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    fetch?: OpenAIProviderSettings['fetch'] | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.fetch = args.fetch
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(args: { card: ModelCard; effort: EEffort }): SharedV4ProviderOptions | undefined {
    return openaiEffortOptions(args)
  }

  model(args: {
    card: ModelCard
    effort: () => EEffort
    accountId?: AccountId | undefined
  }): LanguageModelV4 {
    const authorized = createOpenAiModel({
      credentials: this.credentials,
      providerId: OPENAI_PROVIDER_ID,
      modelId: args.card.ref.modelId,
      accountId: args.accountId,
      ...(this.fetch === undefined ? {} : { fetch: this.fetch }),
    })

    const withProviderOptions = (options: Parameters<LanguageModelV4['doStream']>[0]) => {
      const providerOptions = mergedProviderOptions({
        defaults: this.effortOptions({ card: args.card, effort: args.effort() }),
        call: options.providerOptions,
      })
      if (providerOptions === undefined) return options
      return { ...options, providerOptions }
    }

    return {
      specificationVersion: 'v4',
      provider: OPENAI_PROVIDER_ID,
      modelId: args.card.ref.modelId,
      supportedUrls: {},
      doGenerate: (options) => authorized.doGenerate(withProviderOptions(options)),
      doStream: (options) => authorized.doStream(withProviderOptions(options)),
    }
  }
}
