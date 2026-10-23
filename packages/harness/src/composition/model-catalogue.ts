import { ANTHROPIC_PROVIDER_ID, type Account, type CredentialPort } from '@dltech/atlas-core'
import { cardsForProvider } from '@dltech/atlas-models'

import {
  INFERENCE_PROVIDER_ID,
  composeModelCatalogue,
  OPENAI_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  type ComposedCatalogue,
  type LiveCards,
} from '../models'
import type { ProviderAdapter } from '../providers/adapter'
import { AnthropicAdapter } from '../providers/anthropic-adapter'
import { InferenceAdapter } from '../providers/inference-adapter'
import { OpenAiAdapter } from '../providers/openai-adapter'
import { OpenRouterAdapter } from '../providers/openrouter-adapter'

export {
  catalogueLabel,
  isRefReachable,
  knownRefs,
  unanswerableRef,
  unmeasuredWindowWarning,
  type CatalogueProvider,
  type LiveCards,
} from '../models'

export type ModelCatalogue = ComposedCatalogue & {
  adapterFor: (providerId: string) => ProviderAdapter | undefined
}

export function modelCatalogue(args: {
  adapters: readonly ProviderAdapter[]
  accounts?: readonly Account[]
  live?: LiveCards
}): ModelCatalogue {
  const composed = composeModelCatalogue({
    providers: args.adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      cards: () => adapter.cards(),
    })),
    ...(args.accounts === undefined ? {} : { accounts: args.accounts }),
    ...(args.live === undefined ? {} : { live: args.live }),
  })
  return {
    get providers() {
      return composed.providers
    },
    get catalog() {
      return composed.catalog
    },
    cardFor: composed.cardFor,
    reachable: composed.reachable,
    subscribed: composed.subscribed,
    observeAccounts: composed.observeAccounts,
    subscribe: composed.subscribe,
    version: composed.version,
    adapterFor: (providerId) => args.adapters.find((adapter) => adapter.id === providerId),
  }
}

export const providerAdapters = (args: {
  credentials: CredentialPort
}): readonly ProviderAdapter[] => [
  new AnthropicAdapter({
    credentials: args.credentials,
    cards: cardsForProvider(ANTHROPIC_PROVIDER_ID),
  }),
  new OpenAiAdapter({ credentials: args.credentials, cards: cardsForProvider(OPENAI_PROVIDER_ID) }),
  new OpenRouterAdapter({
    credentials: args.credentials,
    cards: cardsForProvider(OPENROUTER_PROVIDER_ID),
  }),
  new InferenceAdapter({
    credentials: args.credentials,
    cards: cardsForProvider(INFERENCE_PROVIDER_ID),
  }),
]
