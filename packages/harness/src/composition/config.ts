import type { ModelRef } from '@dltech/atlas-core'

export const DEFAULT_MODEL_REF: ModelRef = {
  providerId: 'anthropic',
  modelId: 'claude-haiku-4-5',
}

export const TITLER_MODEL_ID = 'claude-haiku-4-5-20251001'

export const SUMMARISER_MODEL_ID = 'claude-sonnet-5'

export const TLDR_MODEL_ID = 'claude-haiku-4-5-20251001'

/** What a launch decides for itself and nothing that outlives it; anything durable is a setting. */
export type HarnessLaunch = {
  cwd: string
  command: string
  model: string | undefined
  executionLocation: string | undefined
}
