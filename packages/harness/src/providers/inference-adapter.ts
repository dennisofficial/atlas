import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  EAuthProvider,
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { ProviderAdapter } from './adapter'
import { inferenceEffortOptions } from './inference-effort'
import { providerKey } from './provider-key'

export const INFERENCE_PROVIDER_ID = 'inference'

/**
 * models.dev records inference.net's base as `https://inference.net/v1`, which 301s. The host that
 * serves the API is `api.inference.net`. https://docs.inference.net/api/api-quickstart
 */
const INFERENCE_BASE_URL = 'https://api.inference.net/v1'

export class InferenceAdapter extends ProviderAdapter {
  readonly id = INFERENCE_PROVIDER_ID
  readonly label = 'Inference.net'

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly fetch: OpenAICompatibleProviderSettings['fetch'] | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    fetch?: OpenAICompatibleProviderSettings['fetch'] | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.fetch = args.fetch
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(args: { card: ModelCard; effort: EEffort }): SharedV4ProviderOptions | undefined {
    return inferenceEffortOptions(args)
  }

  model(args: {
    card: ModelCard
    effort: () => EEffort
    accountId?: AccountId | undefined
  }): LanguageModelV4 {
    const authorized = async (): Promise<LanguageModelV4> => {
      const credential = await this.credentials.read({
        provider: EAuthProvider.Inference,
        accountId: args.accountId,
      })
      const apiKey = providerKey({ credential, label: this.label })

      return createOpenAICompatible({
        name: INFERENCE_PROVIDER_ID,
        baseURL: INFERENCE_BASE_URL,
        apiKey,
        // Without this flag @ai-sdk/openai-compatible degrades Output.object to
        // { type: 'json_object' }, which reasoning models answer with prose-in-JSON.
        supportsStructuredOutputs: true,
        ...(this.fetch === undefined ? {} : { fetch: this.fetch }),
      }).chatModel(args.card.ref.modelId)
    }

    const withEffort = (options: Parameters<LanguageModelV4['doStream']>[0]) => {
      const effort = this.effortOptions({ card: args.card, effort: args.effort() })
      if (effort === undefined) return options

      const providerOptions = { ...options.providerOptions }
      for (const [provider, bucket] of Object.entries(effort)) {
        providerOptions[provider] = { ...bucket, ...providerOptions[provider] }
      }
      return { ...options, providerOptions }
    }

    return {
      specificationVersion: 'v4',
      provider: INFERENCE_PROVIDER_ID,
      modelId: args.card.ref.modelId,
      supportedUrls: {},
      doGenerate: async (options) => (await authorized()).doGenerate(withEffort(options)),
      doStream: async (options) => (await authorized()).doStream(withEffort(options)),
    }
  }
}
