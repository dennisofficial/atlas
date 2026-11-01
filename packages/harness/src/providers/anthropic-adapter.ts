import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { CLAUDE_PLAN_LABEL } from '../models/provider-ids'
import { ProviderAdapter } from './adapter'
import { anthropicEffortOptions } from './anthropic-effort'
import { createAnthropicOauthModel } from './anthropic-oauth'
import type { ProviderAdmission } from './provider-admission'

export class AnthropicAdapter extends ProviderAdapter {
  readonly id = ANTHROPIC_PROVIDER_ID
  readonly label = CLAUDE_PLAN_LABEL

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly admission: ProviderAdmission | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    admission?: ProviderAdmission | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.admission = args.admission
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(args: { card: ModelCard; effort: EEffort }): SharedV4ProviderOptions | undefined {
    return anthropicEffortOptions(args)
  }

  model(args: {
    card: ModelCard
    effort: () => EEffort
    accountId?: AccountId | undefined
  }): LanguageModelV4 {
    return createAnthropicOauthModel({
      credentials: this.credentials,
      admission: this.admission,
      modelId: args.card.ref.modelId,
      ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
      providerOptions: () => this.effortOptions({ card: args.card, effort: args.effort() }),
    })
  }
}
