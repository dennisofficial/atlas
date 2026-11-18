import type { LanguageModelV4 } from '@ai-sdk/provider'

import { EAuthProvider } from '@dltech/atlas-core'

import { OPENROUTER_LABEL, OPENROUTER_PROVIDER_ID } from '../provider-ids'
import type { ProviderModelArgs } from './model-args'
import { createOpenAiCompatibleModel } from './openai-compatible-model'

// OpenRouter attributes requests to an app via these headers: https://openrouter.ai/docs/app-attribution
const ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://github.com/dennisofficial/atlas',
  'X-Title': 'Atlas',
}

export const createOpenRouterModel = (args: ProviderModelArgs): LanguageModelV4 =>
  createOpenAiCompatibleModel({
    ...args,
    target: {
      providerId: OPENROUTER_PROVIDER_ID,
      label: OPENROUTER_LABEL,
      authProvider: EAuthProvider.OpenRouter,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: ATTRIBUTION_HEADERS,
    },
  })
