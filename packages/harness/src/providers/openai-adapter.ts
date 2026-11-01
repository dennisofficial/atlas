import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import type { OpenAIProviderSettings } from '@ai-sdk/openai'

import { CODEX_PLAN_LABEL, OPENAI_PROVIDER_ID } from '../models/provider-ids'
import { ProviderAdapter } from './adapter'
import { openaiEffortOptions } from './openai-effort'
import { createOpenAiModel, mergedProviderOptions } from './openai-oauth'
import type { ProviderAdmission } from './provider-admission'

export { OPENAI_PROVIDER_ID }

export class OpenAiAdapter extends ProviderAdapter {
  readonly id = OPENAI_PROVIDER_ID
  readonly label = CODEX_PLAN_LABEL

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly fetch: OpenAIProviderSettings['fetch'] | undefined
  private readonly admission: ProviderAdmission | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    admission?: ProviderAdmission | undefined
    fetch?: OpenAIProviderSettings['fetch'] | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.fetch = args.fetch
    this.admission = args.admission
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
      admission: this.admission,
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
      // @ai-sdk/openai's responses model declares image/* and application/pdf in supportedUrls;
      // the SDK inlines any URL part the model's map does not claim.
      supportedUrls: authorized.supportedUrls,
      doGenerate: (options) => authorized.doGenerate(withProviderOptions(options)),
      doStream: (options) => authorized.doStream(withProviderOptions(options)),
    }
  }
}
