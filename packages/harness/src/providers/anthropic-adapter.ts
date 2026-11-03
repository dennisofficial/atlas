import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { CLAUDE_PLAN_LABEL } from '../models/provider-ids'
import { ProviderAdapter, type ModelBuildArgs } from './adapter'
import { anthropicEffortOptions } from './anthropic-effort'
import { createAnthropicOauthModel, type AnthropicFetch } from './anthropic-oauth'
import { withFastFallback } from './fast-fallback'
import { ANTHROPIC_FAST_OPTIONS, runsFast, withFastOptions } from './fast-options'
import type { ProviderAdmission } from './provider-admission'

export class AnthropicAdapter extends ProviderAdapter {
  readonly id = ANTHROPIC_PROVIDER_ID
  readonly label = CLAUDE_PLAN_LABEL

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly admission: ProviderAdmission | undefined
  private readonly fetch: AnthropicFetch | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    admission?: ProviderAdmission | undefined
    fetch?: AnthropicFetch | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.admission = args.admission
    this.fetch = args.fetch
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(args: { card: ModelCard; effort: EEffort }): SharedV4ProviderOptions | undefined {
    return anthropicEffortOptions(args)
  }

  model(args: ModelBuildArgs): LanguageModelV4 {
    const build = (fast: boolean): LanguageModelV4 =>
      createAnthropicOauthModel({
        credentials: this.credentials,
        admission: this.admission,
        modelId: args.card.ref.modelId,
        ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
        ...(this.fetch === undefined ? {} : { fetch: this.fetch }),
        providerOptions: () =>
          withFastOptions({
            options: this.effortOptions({ card: args.card, effort: args.effort() }),
            fast: ANTHROPIC_FAST_OPTIONS,
            enabled: fast,
          }),
      })

    if (args.card.fast !== true) return build(false)
    return withFastFallback({
      build,
      requested: () => runsFast({ card: args.card, fast: args.fast }),
      onRefused: args.onFastRefused,
    })
  }
}
