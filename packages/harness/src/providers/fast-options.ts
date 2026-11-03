import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import type { ModelCard } from '@dltech/atlas-core'

import { CODEX_FAST_SERVICE_TIER } from '../models/codex-models-response'
import { mergedProviderOptions } from './openai-oauth'

export const ANTHROPIC_FAST_OPTIONS: SharedV4ProviderOptions = { anthropic: { speed: 'fast' } }
export const OPENAI_FAST_OPTIONS: SharedV4ProviderOptions = {
  openai: { serviceTier: CODEX_FAST_SERVICE_TIER },
}

export const runsFast = (args: { card: ModelCard; fast: (() => boolean) | undefined }): boolean =>
  args.card.fast === true && args.fast?.() === true

export const withFastOptions = (args: {
  options: SharedV4ProviderOptions | undefined
  fast: SharedV4ProviderOptions
  enabled: boolean
}): SharedV4ProviderOptions | undefined =>
  args.enabled ? mergedProviderOptions({ defaults: args.options, call: args.fast }) : args.options
