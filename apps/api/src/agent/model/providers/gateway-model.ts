import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModelV4 } from '@ai-sdk/provider'

import { EAuthProvider, isAnthropicModel } from '@dltech/atlas-core'

import { GATEWAY_LABEL, GATEWAY_PROVIDER_ID } from '../provider-ids'
import { providerKey } from '../provider-key'
import { authorizedProviderModel } from './authorized-model'
import { gatewayReasoning } from './gateway-effort'
import type { ProviderModelArgs } from './model-args'

// caching: 'auto' has the gateway place the cache markers a provider needs and is a no-op where
// caching is implicit. Anthropic models are the exception: the gateway adds markers of its own on
// top of the breakpoints the assembler places, and Anthropic rejects a fifth.
// https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
const routingOptionsFor = (modelId: string): { caching?: 'auto' } =>
  isAnthropicModel(modelId) ? {} : { caching: 'auto' }

export function createGatewayModel(args: ProviderModelArgs): LanguageModelV4 {
  const fetchSetting = args.fetch === undefined ? {} : { fetch: args.fetch }

  return authorizedProviderModel({
    credentials: args.credentials,
    providerId: GATEWAY_PROVIDER_ID,
    modelId: args.modelId,
    supportedUrls: createGateway({ apiKey: 'unused', ...fetchSetting }).languageModel(args.modelId)
      .supportedUrls,
    authorize: async () => {
      const credential = await args.credentials.read({
        provider: EAuthProvider.Gateway,
        accountId: args.accountId,
      })
      const apiKey = providerKey({ credential, label: GATEWAY_LABEL })
      const model = createGateway({ apiKey, ...fetchSetting }).languageModel(args.modelId)
      return { model, credential }
    },
    prepare: ({ options }) => {
      const reasoning = gatewayReasoning({ card: args.card, effort: args.effort() })
      const routing = {
        ...routingOptionsFor(args.modelId),
        ...options.providerOptions?.[GATEWAY_PROVIDER_ID],
      }
      return {
        ...options,
        ...(reasoning === undefined || options.reasoning !== undefined ? {} : { reasoning }),
        providerOptions: { ...options.providerOptions, [GATEWAY_PROVIDER_ID]: routing },
      }
    },
  })
}
