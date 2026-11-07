import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import type { ModelCard } from '@dltech/atlas-core'

import { mergedProviderOptions } from './merge-options'

export const ANTHROPIC_FAST_OPTIONS: SharedV4ProviderOptions = { anthropic: { speed: 'fast' } }
export const OPENAI_FAST_OPTIONS: SharedV4ProviderOptions = { openai: { serviceTier: 'priority' } }

export const runsFast = (args: {
  card: ModelCard | undefined
  fast: (() => boolean) | undefined
}): boolean => args.card?.fast === true && args.fast?.() === true

export const withFastOptions = (args: {
  options: SharedV4ProviderOptions | undefined
  fast: SharedV4ProviderOptions
  enabled: boolean
}): SharedV4ProviderOptions | undefined =>
  args.enabled ? mergedProviderOptions({ defaults: args.options, call: args.fast }) : args.options
