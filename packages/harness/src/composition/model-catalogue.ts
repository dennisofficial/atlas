import {
  ANTHROPIC_PROVIDER_ID,
  catalogOf,
  EAuthKind,
  findCard,
  reachableProviders,
  refKey,
  type Account,
  type CredentialPort,
  type ModelCard,
  type ModelCatalog,
  type ModelRef,
} from '@dltech/atlas-core'
import { enrichLiveCards } from '../models/enrich-live-cards'
import { cardsForProvider, withoutDatedDuplicates } from '../models/generated-catalogue'
import type { ProviderAdapter } from '../providers/adapter'
import { AnthropicAdapter } from '../providers/anthropic-adapter'
import { INFERENCE_PROVIDER_ID, InferenceAdapter } from '../providers/inference-adapter'
import { OPENAI_PROVIDER_ID, OpenAiAdapter } from '../providers/openai-adapter'
import { OPENROUTER_PROVIDER_ID, OpenRouterAdapter } from '../providers/openrouter-adapter'

export type CatalogueProvider = {
  id: string
  label: string
  cards: readonly ModelCard[]
}

export type ModelCatalogue = {
  providers: readonly CatalogueProvider[]
  catalog: ModelCatalog
  cardFor: (ref: ModelRef) => ModelCard | undefined
  adapterFor: (providerId: string) => ProviderAdapter | undefined
  reachable: (providerId: string) => boolean
  subscribed: (providerId: string) => boolean
  observeAccounts: (accounts: readonly Account[]) => void
  subscribe: (listener: () => void) => () => void
  version: () => number
}

const providersHolding = (args: {
  accounts: readonly Account[]
  wanted: (account: Account) => boolean
}): ReadonlySet<string> =>
  new Set(
    reachableProviders()
      .filter((spec) =>
        args.accounts.some((account) => account.provider === spec.provider && args.wanted(account)),
      )
      .map((spec) => String(spec.provider)),
  )

const keyedProviders = (accounts: readonly Account[]): ReadonlySet<string> =>
  providersHolding({ accounts, wanted: () => true })

/**
 * A five-hour and a weekly window are what a plan meters. A key on the same provider is billed per
 * token and reports neither, so a footer that showed them would be drawing somebody else's numbers.
 */
const subscribedProviders = (accounts: readonly Account[]): ReadonlySet<string> =>
  providersHolding({ accounts, wanted: (account) => account.kind === EAuthKind.Oauth })

type ResolvedCards = { providers: readonly CatalogueProvider[]; catalog: ModelCatalog }

/**
 * The codex subscription backend serves a plan-scoped subset of the OpenAI catalogue and 400s the
 * rest, so a ChatGPT login lists what the backend returned. A key bills against api.openai.com and
 * keeps the full static list. Live cards carry no price or output cap and may report no window, so
 * the generated card for the same model fills whatever the live card leaves out.
 */
function resolveCards(args: {
  adapters: readonly ProviderAdapter[]
  subscribed: ReadonlySet<string>
  live: LiveCards | undefined
}): ResolvedCards {
  const providers: CatalogueProvider[] = []
  const catalogued: ModelCard[] = []

  for (const adapter of args.adapters) {
    const live = args.subscribed.has(adapter.id) ? args.live?.cards(adapter.id) : undefined
    if (live !== undefined && live.length > 0) {
      const enriched = enrichLiveCards({ live, generated: adapter.cards() })
      providers.push({ id: adapter.id, label: adapter.label, cards: enriched })
      catalogued.push(...enriched)
      continue
    }
    providers.push({
      id: adapter.id,
      label: adapter.label,
      cards: withoutDatedDuplicates(adapter.cards()),
    })
    catalogued.push(...adapter.cards())
  }

  return { providers, catalog: catalogOf(catalogued) }
}

export type LiveCards = {
  cards: (providerId: string) => readonly ModelCard[] | undefined
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void>
}

export function modelCatalogue(args: {
  adapters: readonly ProviderAdapter[]
  accounts?: readonly Account[]
  live?: LiveCards
}): ModelCatalogue {
  let keyed = keyedProviders(args.accounts ?? [])
  let subscribed = subscribedProviders(args.accounts ?? [])

  const listeners = new Set<() => void>()
  let version = 0
  let resolved: ResolvedCards | undefined

  const resolve = (): ResolvedCards => {
    resolved ??= resolveCards({ adapters: args.adapters, subscribed, live: args.live })
    return resolved
  }

  const announce = (): void => {
    resolved = undefined
    version += 1
    for (const listener of listeners) listener()
  }

  args.live?.subscribe(announce)

  return {
    get providers() {
      return resolve().providers
    },
    get catalog() {
      return resolve().catalog
    },
    cardFor: (ref) => findCard({ catalog: resolve().catalog, ref }),
    adapterFor: (providerId) => args.adapters.find((adapter) => adapter.id === providerId),
    reachable: (providerId) => keyed.has(providerId),
    subscribed: (providerId) => subscribed.has(providerId),
    observeAccounts: (accounts) => {
      keyed = keyedProviders(accounts)
      subscribed = subscribedProviders(accounts)
      announce()
      if (subscribed.has(OPENAI_PROVIDER_ID)) void args.live?.refresh()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version,
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

export const unanswerableRef = (key: string): Error =>
  new Error(`no provider adapter can answer for ${key}`)

export const isRefReachable = (args: { catalogue: ModelCatalogue; ref: ModelRef }): boolean =>
  args.catalogue.cardFor(args.ref) !== undefined && args.catalogue.reachable(args.ref.providerId)

/**
 * The window the model port reads comes from this card. With no card `contextWindowOf` answers
 * `CONTEXT_WINDOW_UNMEASURED`, which `autoCompactBeforeStep` reads as "hold" — so auto-compact and
 * the context meter both stop without anything failing. Worth saying out loud once.
 */
export const unmeasuredWindowWarning = (args: {
  catalogue: ModelCatalogue
  ref: ModelRef
}): string | null =>
  args.catalogue.cardFor(args.ref) === undefined
    ? `Auto-compact and the context meter are off — no context window known for ${refKey(args.ref)}.`
    : null

export const catalogueLabel = (args: { catalogue: ModelCatalogue; ref: ModelRef }): string =>
  args.catalogue.cardFor(args.ref)?.label ?? args.ref.modelId

export const knownRefs = (catalogue: ModelCatalogue): readonly string[] =>
  [...catalogue.catalog.values()].map((card) => refKey(card.ref))
