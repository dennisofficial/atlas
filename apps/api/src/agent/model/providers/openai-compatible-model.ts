import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4 } from '@ai-sdk/provider'

import type { EAuthProvider } from '@dltech/atlas-core'

import { providerKey } from '../provider-key'
import { authorizedProviderModel } from './authorized-model'
import { mergedProviderOptions } from './merge-options'
import type { ProviderModelArgs } from './model-args'
import { reasoningEffortOptions } from './reasoning-effort-options'

export type OpenAiCompatibleTarget = {
  providerId: string
  label: string
  authProvider: EAuthProvider
  baseURL: string
  headers?: Record<string, string> | undefined
}

// Without supportsStructuredOutputs @ai-sdk/openai-compatible degrades Output.object to
// { type: 'json_object' }, which reasoning models answer with prose-in-JSON:
// https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts
export function createOpenAiCompatibleModel(
  args: ProviderModelArgs & { target: OpenAiCompatibleTarget },
): LanguageModelV4 {
  const { target } = args
  const settings = {
    name: target.providerId,
    baseURL: target.baseURL,
    supportsStructuredOutputs: true,
    ...(target.headers === undefined ? {} : { headers: target.headers }),
    ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
  }

  return authorizedProviderModel({
    credentials: args.credentials,
    providerId: target.providerId,
    modelId: args.modelId,
    supportedUrls: createOpenAICompatible(settings).chatModel(args.modelId).supportedUrls,
    authorize: async () => {
      const credential = await args.credentials.read({
        provider: target.authProvider,
        accountId: args.accountId,
      })
      const apiKey = providerKey({ credential, label: target.label })
      const model = createOpenAICompatible({ ...settings, apiKey }).chatModel(args.modelId)
      return { model, credential }
    },
    prepare: ({ options }) => {
      const providerOptions = mergedProviderOptions({
        defaults: reasoningEffortOptions({
          providerId: target.providerId,
          card: args.card,
          effort: args.effort(),
        }),
        call: options.providerOptions,
      })
      return providerOptions === undefined ? options : { ...options, providerOptions }
    },
  })
}
