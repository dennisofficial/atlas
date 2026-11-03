import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import type { AccountId, EEffort, ModelCard } from '@dltech/atlas-core'

export type ModelBuildArgs = {
  card: ModelCard
  effort: () => EEffort
  fast?: (() => boolean) | undefined
  onFastRefused?: (() => void) | undefined
  accountId?: AccountId | undefined
}

export abstract class ProviderAdapter {
  abstract readonly id: string
  abstract readonly label: string

  abstract cards(): readonly ModelCard[]

  abstract model(args: ModelBuildArgs): LanguageModelV4

  abstract effortOptions(args: {
    card: ModelCard
    effort: EEffort
  }): SharedV4ProviderOptions | undefined
}
