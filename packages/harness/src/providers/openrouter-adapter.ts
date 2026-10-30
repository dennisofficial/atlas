import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  EAuthProvider,
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { OPENROUTER_LABEL, OPENROUTER_PROVIDER_ID } from '../models/provider-ids'
import { ProviderAdapter } from './adapter'
import { openrouterEffortOptions } from './openrouter-effort'
import { failingAs } from './failure-account'
import { providerKey } from './provider-key'

export { OPENROUTER_PROVIDER_ID }

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// OpenRouter attributes requests to an app via these headers; without them usage
// lands under "Unknown" in the app rankings. https://openrouter.ai/docs/app-attribution
const ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://github.com/dennisofficial/atlas',
  'X-Title': 'Atlas',
}

export class OpenRouterAdapter extends ProviderAdapter {
  readonly id = OPENROUTER_PROVIDER_ID
  readonly label = OPENROUTER_LABEL

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly baseUrl: string | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    baseUrl?: string | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.baseUrl = args.baseUrl
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(args: { card: ModelCard; effort: EEffort }): SharedV4ProviderOptions | undefined {
    return openrouterEffortOptions(args)
  }

  private readonly compatible = (): ReturnType<typeof createOpenAICompatible> =>
    createOpenAICompatible({
      name: OPENROUTER_PROVIDER_ID,
      baseURL: this.baseUrl ?? OPENROUTER_BASE_URL,
      // supportedUrls reads pure provider config, so a credential-less instance answers it.
      headers: ATTRIBUTION_HEADERS,
      supportsStructuredOutputs: true,
    })

  model(args: {
    card: ModelCard
    effort: () => EEffort
    accountId?: AccountId | undefined
  }): LanguageModelV4 {
    const authorized = async (): Promise<{ model: LanguageModelV4; accountId: AccountId }> => {
      const credential = await this.credentials.read({
        provider: EAuthProvider.OpenRouter,
        accountId: args.accountId,
      })
      const apiKey = providerKey({ credential, label: this.label })

      const model = createOpenAICompatible({
        name: OPENROUTER_PROVIDER_ID,
        baseURL: this.baseUrl ?? OPENROUTER_BASE_URL,
        apiKey,
        headers: ATTRIBUTION_HEADERS,
        // Without this flag @ai-sdk/openai-compatible degrades Output.object to
        // { type: 'json_object' }, which reasoning models answer with prose-in-JSON.
        supportsStructuredOutputs: true,
      }).chatModel(args.card.ref.modelId)
      return { model, accountId: credential.accountId }
    }

    const withEffort = (options: Parameters<LanguageModelV4['doStream']>[0]) => {
      const effort = this.effortOptions({ card: args.card, effort: args.effort() })
      if (effort === undefined) return options
      return { ...options, providerOptions: { ...effort, ...options.providerOptions } }
    }

    return {
      specificationVersion: 'v4',
      provider: OPENROUTER_PROVIDER_ID,
      modelId: args.card.ref.modelId,
      // @ai-sdk/openai-compatible answers supportedUrls from provider config; deferring to it keeps
      // the map in step with the model instead of freezing an empty one here.
      supportedUrls: this.compatible().chatModel(args.card.ref.modelId).supportedUrls,
      doGenerate: async (options) => {
        const { model, accountId } = await authorized()
        return failingAs({ accountId, run: () => model.doGenerate(withEffort(options)) })
      },
      doStream: async (options) => {
        const { model, accountId } = await authorized()
        return failingAs({ accountId, run: () => model.doStream(withEffort(options)) })
      },
    }
  }
}
