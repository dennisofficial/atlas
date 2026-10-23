import type { EBrand } from '#components/brand-mark'

export enum EEffort {
  Off = 'off',
  Minimal = 'minimal',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  XHigh = 'xhigh',
  Max = 'max',
}

export const EFFORT_LADDER: readonly EEffort[] = [
  EEffort.Off,
  EEffort.Minimal,
  EEffort.Low,
  EEffort.Medium,
  EEffort.High,
  EEffort.XHigh,
  EEffort.Max,
]

export const EFFORT_LABELS: Record<EEffort, string> = {
  [EEffort.Off]: 'Off',
  [EEffort.Minimal]: 'Minimal',
  [EEffort.Low]: 'Low',
  [EEffort.Medium]: 'Medium',
  [EEffort.High]: 'High',
  [EEffort.XHigh]: 'Extra high',
  [EEffort.Max]: 'Max',
}

export const DEFAULT_EFFORTS: readonly EEffort[] = [EEffort.Low, EEffort.Medium, EEffort.High]

export enum EModelFilter {
  Images = 'images',
  Reasoning = 'reasoning',
  LongContext = 'long-context',
}

export const MODEL_FILTER_ORDER: readonly EModelFilter[] = [
  EModelFilter.Images,
  EModelFilter.Reasoning,
  EModelFilter.LongContext,
]

export const MODEL_FILTER_LABELS: Record<EModelFilter, string> = {
  [EModelFilter.Images]: 'Images',
  [EModelFilter.Reasoning]: 'Reasoning',
  [EModelFilter.LongContext]: '≥200k',
}

export const LONG_CONTEXT_TOKENS = 200_000

export const DEFAULT_COLLAPSED_LIMIT = 5

export const SEARCH_COLLAPSED_LIMIT = 25

export interface ModelOption {
  id: string
  label: string
  provider?: string
  context?: string
  rate?: string
  route?: string
  brand?: EBrand
  monogram?: string
  auto?: boolean
  efforts?: EEffort[]
  images?: boolean
  contextTokens?: number
}

export interface ProviderModels {
  provider: string
  models: ModelOption[]
}

export enum EProviderGroupKind {
  Models = 'models',
  Reconnect = 'reconnect',
}

export type ProviderGroup =
  | {
      kind: EProviderGroupKind.Models
      provider: string
      models: ModelOption[]
      hidden: number
      total: number
    }
  | { kind: EProviderGroupKind.Reconnect; provider: string }

export enum EModelSelectorState {
  Results = 'results',
  NoMatches = 'no-matches',
  NoProviders = 'no-providers',
}

export interface ModelSelectorGroups {
  state: EModelSelectorState
  auto: ModelOption | undefined
  pinned: ModelOption[]
  providers: ProviderGroup[]
  showManageProviders: boolean
}

export const MANAGE_PROVIDERS_VALUE = 'manage-providers'

export const reconnectItemValue = (provider: string): string => `reconnect:${provider}`

export const showAllItemValue = (provider: string): string => `show-all:${provider}`

const FALLBACK_PROVIDER = 'Models'

const providerOf = (model: ModelOption): string => model.provider ?? FALLBACK_PROVIDER

export function groupByProvider(models: ModelOption[]): ProviderModels[] {
  const groups = new Map<string, ModelOption[]>()
  for (const model of models) {
    const provider = providerOf(model)
    groups.set(provider, [...(groups.get(provider) ?? []), model])
  }
  return [...groups].map(([provider, grouped]) => ({
    provider,
    models: grouped,
  }))
}

const SEPARATORS = /[-_./:]+/g

const spaced = (text: string): string => text.toLowerCase().replace(SEPARATORS, ' ')

export function queryTerms(query: string): string[] {
  return spaced(query.trim()).split(/\s+/).filter(Boolean)
}

export function includesAll({ text, terms }: { text: string; terms: readonly string[] }): boolean {
  const haystack = spaced(text)
  const compact = haystack.replace(/\s+/g, '')
  return terms.every((term) => haystack.includes(term) || compact.includes(term))
}

export function matchesQuery({
  model,
  terms,
}: {
  model: ModelOption
  terms: readonly string[]
}): boolean {
  const text = `${model.auto ? 'auto' : ''} ${model.label} ${model.id} ${providerOf(model)} ${model.route ?? ''}`
  return includesAll({ text, terms })
}

const FILTER_TESTS: Record<EModelFilter, (model: ModelOption) => boolean> = {
  [EModelFilter.Images]: (model) => model.images === true,
  [EModelFilter.Reasoning]: (model) => (model.efforts?.length ?? 0) > 0,
  [EModelFilter.LongContext]: (model) => (model.contextTokens ?? 0) >= LONG_CONTEXT_TOKENS,
}

const FILTER_DATA: Record<EModelFilter, (model: ModelOption) => boolean> = {
  [EModelFilter.Images]: (model) => model.images !== undefined,
  [EModelFilter.Reasoning]: (model) => model.efforts !== undefined,
  [EModelFilter.LongContext]: (model) => model.contextTokens !== undefined,
}

export function availableFilters(models: readonly ModelOption[]): EModelFilter[] {
  return MODEL_FILTER_ORDER.filter((filter) => models.some(FILTER_DATA[filter]))
}

function passesFilters({
  model,
  filters,
}: {
  model: ModelOption
  filters: readonly EModelFilter[]
}): boolean {
  return filters.every((filter) => FILTER_TESTS[filter](model))
}

function stateOf({
  hasProviders,
  hasResults,
}: {
  hasProviders: boolean
  hasResults: boolean
}): EModelSelectorState {
  if (!hasProviders) return EModelSelectorState.NoProviders
  return hasResults ? EModelSelectorState.Results : EModelSelectorState.NoMatches
}

export function modelSelectorGroups({
  models,
  query = '',
  pinned = [],
  reconnectProviders = [],
  canManageProviders = false,
  filters = [],
  collapsedProviders = [],
  collapsedLimit = DEFAULT_COLLAPSED_LIMIT,
  expandedProviders = [],
}: {
  models: ModelOption[]
  query?: string
  pinned?: readonly string[]
  reconnectProviders?: readonly string[]
  canManageProviders?: boolean
  filters?: readonly EModelFilter[]
  collapsedProviders?: readonly string[]
  collapsedLimit?: number
  expandedProviders?: readonly string[]
}): ModelSelectorGroups {
  const terms = queryTerms(query)
  const matches = (model: ModelOption) =>
    matchesQuery({ model, terms }) && passesFilters({ model, filters })
  const reconnecting = new Set(reconnectProviders)
  const collapsed = new Set(collapsedProviders)
  const expanded = new Set(expandedProviders)
  const selectable = models.filter((model) => !model.auto)
  const usable = selectable.filter((model) => !reconnecting.has(providerOf(model)))

  const autoOption = models.find((model) => model.auto)
  const auto =
    autoOption !== undefined && filters.length === 0 && matchesQuery({ model: autoOption, terms })
      ? autoOption
      : undefined

  const byId = new Map(usable.map((model) => [model.id, model]))
  const pinnedInOrder = [...new Set(pinned)].flatMap((id) => {
    const model = byId.get(id)
    return model === undefined ? [] : [model]
  })
  const pinnedIds = new Set(pinnedInOrder.map((model) => model.id))

  const usableByProvider = new Map(
    groupByProvider(usable).map((group) => [group.provider, group.models]),
  )
  const providerOrder = [
    ...new Set([
      ...groupByProvider(selectable).map((group) => group.provider),
      ...reconnectProviders,
    ]),
  ]

  const limitFor = (provider: string): number => {
    if (!collapsed.has(provider) || expanded.has(provider)) return Number.POSITIVE_INFINITY
    return terms.length > 0 ? Math.max(collapsedLimit, SEARCH_COLLAPSED_LIMIT) : collapsedLimit
  }

  const providers = providerOrder.flatMap((provider): ProviderGroup[] => {
    if (reconnecting.has(provider)) {
      return filters.length === 0 && includesAll({ text: provider, terms })
        ? [{ kind: EProviderGroupKind.Reconnect, provider }]
        : []
    }
    const matched = (usableByProvider.get(provider) ?? []).filter(
      (model) => !pinnedIds.has(model.id) && matches(model),
    )
    if (matched.length === 0) return []
    const shown = matched.slice(0, limitFor(provider))
    return [
      {
        kind: EProviderGroupKind.Models,
        provider,
        models: shown,
        hidden: matched.length - shown.length,
        total: matched.length,
      },
    ]
  })

  const pinnedShown = pinnedInOrder.filter(matches)
  const state = stateOf({
    hasProviders: models.length > 0 || reconnectProviders.length > 0,
    hasResults: auto !== undefined || pinnedShown.length > 0 || providers.length > 0,
  })

  return {
    state,
    auto,
    pinned: pinnedShown,
    providers,
    showManageProviders: canManageProviders && state !== EModelSelectorState.NoProviders,
  }
}

export function firstItemValue(groups: ModelSelectorGroups): string | undefined {
  if (groups.auto !== undefined) return groups.auto.id
  const firstPinned = groups.pinned[0]
  if (firstPinned !== undefined) return firstPinned.id
  const firstGroup = groups.providers[0]
  if (firstGroup?.kind === EProviderGroupKind.Models) return firstGroup.models[0]?.id
  if (firstGroup?.kind === EProviderGroupKind.Reconnect)
    return reconnectItemValue(firstGroup.provider)
  return groups.showManageProviders ? MANAGE_PROVIDERS_VALUE : undefined
}

export function togglePinned({ pinned, id }: { pinned: readonly string[]; id: string }): string[] {
  return pinned.includes(id) ? pinned.filter((pinnedId) => pinnedId !== id) : [...pinned, id]
}
