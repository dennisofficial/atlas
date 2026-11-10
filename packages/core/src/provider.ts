import type { JsonValue } from './json/value'

export type ProviderOptions = Record<string, Record<string, JsonValue>>

export type ProviderIdentity = { id: string; modelId: string }

export const ANTHROPIC_MODEL_PREFIX = 'anthropic/'

/** Gateway model ids carry their owner as a prefix, so the protocol follows the model, not the route. */
export const isAnthropicModel = (modelId: string): boolean =>
  modelId.startsWith(ANTHROPIC_MODEL_PREFIX)
