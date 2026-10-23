import {
  ANTHROPIC_PROVIDER_ID,
  catalogOf,
  EAuthKind,
  findCard,
  reachableProviders,
  refKey,
  type Account,
  type ModelCard,
  type ModelCatalog,
  type ModelRef,
} from '@dltech/atlas-core'
import { cardsForProvider, enrichLiveCards, withoutDatedDuplicates } from '@dltech/atlas-models'

import {
  CLAUDE_PLAN_LABEL,
  CODEX_PLAN_LABEL,
  INFERENCE_LABEL,
  INFERENCE_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  OPENROUTER_LABEL,
  OPENROUTER_PROVIDER_ID,
} from './provider-ids'

export type CatalogueProvider = {
  id: string
  label: string
  cards: readonly ModelCard[]
}

export type CatalogueSource = {
  id: string
  label: string
  cards: () => readonly ModelCard[]
}

export type LiveCards = {
  cards: (providerId: string) => readonly ModelCard[] | undefined
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void>
}

export type ComposedCatalogue = {
  providers: readonly CatalogueProvider[]
  catalog: ModelCatalog
  cardFor: (ref: ModelRef) => ModelCard | undefined
  reachable: (providerId: string) => boolean
  subscribed: (providerId: string) => boolean
  observeAccounts: (accounts: readonly Account[]) => void
  subscribe: (listener: () => void) => () => void
  version: () => number
}

type ResolvedCards = { providers: readonly CatalogueProvider[]; catalog: ModelCatalog }

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

export const keyedProviders = (accounts: readonly Account[]): ReadonlySet<string> =>
  providersHolding({ accounts, wanted: () => true })

/**
 * A five-hour and a weekly window are what a plan meters. A key on the same provider is billed per
 * token and reports neither, so a footer that showed them would be drawing somebody else's numbers.
 */
export const subscribedProviders = (accounts: readonly Account[]): ReadonlySet<string> =>
  providersHolding({ accounts, wanted: (account) => account.kind === EAuthKind.Oauth })

/**
 * The codex subscription backend serves a plan-scoped subset of the OpenAI catalogue and 400s the
 * rest, so a ChatGPT login lists what the backend returned. A key bills against api.openai.com and
 * keeps the full static list. Live cards carry no price or output cap and may report no window, so
 * the generated card for the same model fills whatever the live card leaves out.
 */
function resolveCards(args: {
  sources: readonly CatalogueSource[]
  subscribed: ReadonlySet<string>
  live: LiveCards | undefined
}): ResolvedCards {
  const providers: CatalogueProvider[] = []
  const catalogued: ModelCard[] = []

  for (const source of args.sources) {
    const live = args.subscribed.has(source.id) ? args.live?.cards(source.id) : undefined
    if (live !== undefined && live.length > 0) {
      const enriched = enrichLiveCards({ live, generated: source.cards() })
      providers.push({ id: source.id, label: source.label, cards: enriched })
      catalogued.push(...enriched)
      continue
    }
    providers.push({
      id: source.id,
      label: source.label,
      cards: withoutDatedDuplicates(source.cards()),
    })
    catalogued.push(...source.cards())
  }

  return { providers, catalog: catalogOf(catalogued) }
}

export function composeModelCatalogue(args: {
  providers: readonly CatalogueSource[]
  accounts?: readonly Account[]
  live?: LiveCards
}): ComposedCatalogue {
  let keyed = keyedProviders(args.accounts ?? [])
  let subscribed = subscribedProviders(args.accounts ?? [])

  const listeners = new Set<() => void>()
  let version = 0
  let resolved: ResolvedCards | undefined

  const resolve = (): ResolvedCards => {
    resolved ??= resolveCards({ sources: args.providers, subscribed, live: args.live })
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

const staticSource = (args: { id: string; label: string }): CatalogueSource => ({
  ...args,
  cards: () => cardsForProvider(args.id),
})

export const catalogueProviders = (): readonly CatalogueSource[] => [
  staticSource({ id: ANTHROPIC_PROVIDER_ID, label: CLAUDE_PLAN_LABEL }),
  staticSource({ id: OPENAI_PROVIDER_ID, label: CODEX_PLAN_LABEL }),
  staticSource({ id: OPENROUTER_PROVIDER_ID, label: OPENROUTER_LABEL }),
  staticSource({ id: INFERENCE_PROVIDER_ID, label: INFERENCE_LABEL }),
]

export const unanswerableRef = (key: string): Error =>
  new Error(`no provider adapter can answer for ${key}`)

export const isRefReachable = (args: { catalogue: ComposedCatalogue; ref: ModelRef }): boolean =>
  args.catalogue.cardFor(args.ref) !== undefined && args.catalogue.reachable(args.ref.providerId)

/**
 * The window the model port reads comes from this card. With no card `contextWindowOf` answers
 * `CONTEXT_WINDOW_UNMEASURED`, which `autoCompactBeforeStep` reads as "hold" — so auto-compact and
 * the context meter both stop without anything failing. Worth saying out loud once.
 */
export const unmeasuredWindowWarning = (args: {
  catalogue: ComposedCatalogue
  ref: ModelRef
}): string | null =>
  args.catalogue.cardFor(args.ref) === undefined
    ? `Auto-compact and the context meter are off — no context window known for ${refKey(args.ref)}.`
    : null

export const catalogueLabel = (args: { catalogue: ComposedCatalogue; ref: ModelRef }): string =>
  args.catalogue.cardFor(args.ref)?.label ?? args.ref.modelId

export const knownRefs = (catalogue: ComposedCatalogue): readonly string[] =>
  [...catalogue.catalog.values()].map((card) => refKey(card.ref))
