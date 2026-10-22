export interface ModelOption {
  id: string
  label: string
  provider?: string
  context?: string
  rate?: string
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
  | { kind: EProviderGroupKind.Models; provider: string; models: ModelOption[] }
  | { kind: EProviderGroupKind.Reconnect; provider: string }

export enum EModelSelectorState {
  Results = 'results',
  NoMatches = 'no-matches',
  NoProviders = 'no-providers',
}

export interface ModelSelectorGroups {
  state: EModelSelectorState
  pinned: ModelOption[]
  providers: ProviderGroup[]
  showManageProviders: boolean
}

export const MANAGE_PROVIDERS_VALUE = 'manage-providers'

export const reconnectItemValue = (provider: string): string => `reconnect:${provider}`

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

function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function includesAll({ text, terms }: { text: string; terms: readonly string[] }): boolean {
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function matchesQuery({
  model,
  terms,
}: {
  model: ModelOption
  terms: readonly string[]
}): boolean {
  return includesAll({ text: `${model.label} ${model.id} ${providerOf(model)}`, terms })
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
}: {
  models: ModelOption[]
  query?: string
  pinned?: readonly string[]
  reconnectProviders?: readonly string[]
  canManageProviders?: boolean
}): ModelSelectorGroups {
  const terms = queryTerms(query)
  const matches = (model: ModelOption) => matchesQuery({ model, terms })
  const reconnecting = new Set(reconnectProviders)
  const usable = models.filter((model) => !reconnecting.has(providerOf(model)))

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
    ...new Set([...groupByProvider(models).map((group) => group.provider), ...reconnectProviders]),
  ]

  const providers = providerOrder.flatMap((provider): ProviderGroup[] => {
    if (reconnecting.has(provider)) {
      return includesAll({ text: provider, terms })
        ? [{ kind: EProviderGroupKind.Reconnect, provider }]
        : []
    }
    const shown = (usableByProvider.get(provider) ?? []).filter(
      (model) => !pinnedIds.has(model.id) && matches(model),
    )
    return shown.length === 0 ? [] : [{ kind: EProviderGroupKind.Models, provider, models: shown }]
  })

  const pinnedShown = pinnedInOrder.filter(matches)
  const state = stateOf({
    hasProviders: models.length > 0 || reconnectProviders.length > 0,
    hasResults: pinnedShown.length > 0 || providers.length > 0,
  })

  return {
    state,
    pinned: pinnedShown,
    providers,
    showManageProviders: canManageProviders && state !== EModelSelectorState.NoProviders,
  }
}

export function firstItemValue(groups: ModelSelectorGroups): string | undefined {
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
