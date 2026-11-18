import type { LanguageModelV4 } from '@ai-sdk/provider'

import { EAuthProvider } from '@dltech/atlas-core'

import { INFERENCE_LABEL, INFERENCE_PROVIDER_ID } from '../provider-ids'
import type { ProviderModelArgs } from './model-args'
import { createOpenAiCompatibleModel } from './openai-compatible-model'

// models.dev lists https://inference.net/v1, which 301s; the API host is api.inference.net: https://docs.inference.net/api/api-quickstart
const INFERENCE_BASE_URL = 'https://api.inference.net/v1'

export const createInferenceModel = (args: ProviderModelArgs): LanguageModelV4 =>
  createOpenAiCompatibleModel({
    ...args,
    target: {
      providerId: INFERENCE_PROVIDER_ID,
      label: INFERENCE_LABEL,
      authProvider: EAuthProvider.Inference,
      baseURL: INFERENCE_BASE_URL,
    },
  })
