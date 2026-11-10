import { createGateway, type GatewayProviderSettings } from '@ai-sdk/gateway'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'

import {
  EAuthProvider,
  isAnthropicModel,
  type AccountId,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { GATEWAY_LABEL, GATEWAY_PROVIDER_ID } from '../models/provider-ids'
import { ProviderAdapter } from './adapter'
import { failingAs } from './failure-account'
import { gatewayReasoning } from './gateway-effort'
import { admittedByAccount, type ProviderAdmission } from './provider-admission'
import { providerKey } from './provider-key'
import { withStreamProvenance } from './stream-provenance'

export { GATEWAY_PROVIDER_ID }

/**
 * `caching: 'auto'` has the gateway place the cache markers a provider needs and is a no-op where
 * caching is implicit. Anthropic models are the exception: the gateway adds markers of its own on
 * top of the breakpoints the assembler places, and Anthropic rejects a fifth.
 * https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
 */
const routingOptionsFor = (modelId: string): { caching?: 'auto' } =>
  isAnthropicModel(modelId) ? {} : { caching: 'auto' }

export class GatewayAdapter extends ProviderAdapter {
  readonly id = GATEWAY_PROVIDER_ID
  readonly label = GATEWAY_LABEL

  private readonly credentials: CredentialPort
  private readonly catalogue: readonly ModelCard[]
  private readonly admission: ProviderAdmission | undefined
  private readonly fetch: GatewayProviderSettings['fetch'] | undefined

  constructor(args: {
    credentials: CredentialPort
    cards: readonly ModelCard[]
    admission?: ProviderAdmission | undefined
    fetch?: GatewayProviderSettings['fetch'] | undefined
  }) {
    super()
    this.credentials = args.credentials
    this.catalogue = args.cards
    this.admission = args.admission
    this.fetch = args.fetch
  }

  cards(): readonly ModelCard[] {
    return this.catalogue
  }

  effortOptions(): SharedV4ProviderOptions | undefined {
    return undefined
  }

  model(args: {
    card: ModelCard
    effort: () => EEffort
    accountId?: AccountId | undefined
  }): LanguageModelV4 {
    const modelId = args.card.ref.modelId

    const authorized = async (): Promise<{ model: LanguageModelV4; accountId: AccountId }> => {
      const credential = await this.credentials.read({
        provider: EAuthProvider.Gateway,
        accountId: args.accountId,
      })
      const apiKey = providerKey({ credential, label: this.label })

      const provider = createGateway({
        apiKey,
        ...(this.fetch === undefined ? {} : { fetch: this.fetch }),
      }).languageModel(modelId)
      const model = admittedByAccount({
        admission: this.admission,
        model: provider,
        credential,
        providerId: GATEWAY_PROVIDER_ID,
        modelId,
      })
      return { model, accountId: credential.accountId }
    }

    const prepared = (options: LanguageModelV4CallOptions): LanguageModelV4CallOptions => {
      const reasoning = gatewayReasoning({ card: args.card, effort: args.effort() })
      const routing = {
        ...routingOptionsFor(modelId),
        ...options.providerOptions?.[GATEWAY_PROVIDER_ID],
      }
      return {
        ...options,
        ...(reasoning === undefined || options.reasoning !== undefined ? {} : { reasoning }),
        providerOptions: { ...options.providerOptions, [GATEWAY_PROVIDER_ID]: routing },
      }
    }

    const provenanceOf = (accountId: AccountId) => ({
      accountId,
      providerId: GATEWAY_PROVIDER_ID,
      modelId,
      authorizationDelivered: true,
    })

    return {
      specificationVersion: 'v4',
      provider: GATEWAY_PROVIDER_ID,
      modelId,
      supportedUrls: createGateway({ apiKey: 'unused' }).languageModel(modelId).supportedUrls,
      doGenerate: async (options) => {
        const { model, accountId } = await authorized()
        return failingAs({
          ...provenanceOf(accountId),
          run: () => model.doGenerate(prepared(options)),
        })
      },
      doStream: async (options) => {
        const { model, accountId } = await authorized()
        const provenance = provenanceOf(accountId)
        return failingAs({
          ...provenance,
          run: async () =>
            withStreamProvenance({
              result: await model.doStream(prepared(options)),
              provenance,
            }),
        })
      },
    }
  }
}
