import type { LanguageModelV4 } from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  findCard,
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelRef,
} from '@dltech/atlas-core'
import { generatedCatalogue } from '@dltech/atlas-models'

import {
  GATEWAY_PROVIDER_ID,
  INFERENCE_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
} from '../provider-ids'
import { createAnthropicModel } from './anthropic-model'
import { createGatewayModel } from './gateway-model'
import { createInferenceModel } from './inference-model'
import { createOpenAiProviderModel } from './openai-provider'
import { createOpenRouterModel } from './openrouter-model'
import { UnsupportedProviderError } from './unsupported-provider-error'

export { UnsupportedProviderError }

export function createProviderModel(args: {
  ref: ModelRef
  credentials: CredentialPort
  accountId?: AccountId | undefined
  effort: () => EEffort
  fast?: (() => boolean) | undefined
  fetch?: typeof fetch | undefined
}): LanguageModelV4 {
  const { ref, ...rest } = args
  const shared = {
    ...rest,
    modelId: ref.modelId,
    card: findCard({ catalog: generatedCatalogue(), ref }),
  }

  switch (ref.providerId) {
    case ANTHROPIC_PROVIDER_ID:
      return createAnthropicModel(shared)
    case OPENAI_PROVIDER_ID:
      return createOpenAiProviderModel(shared)
    case OPENROUTER_PROVIDER_ID:
      return createOpenRouterModel(shared)
    case INFERENCE_PROVIDER_ID:
      return createInferenceModel(shared)
    case GATEWAY_PROVIDER_ID:
      return createGatewayModel(shared)
    default:
      throw new UnsupportedProviderError(ref.providerId)
  }
}
