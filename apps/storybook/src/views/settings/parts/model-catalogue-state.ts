import {
  EModelFilter,
  LONG_CONTEXT_TOKENS,
  includesAll,
  queryTerms,
} from '@dltech/atlas-ui/ai/model-selector'

import type { EProviderId } from '../../../fixtures/settings-agent'
import {
  PROVIDER_LABELS,
  type EAgentRole,
  type ModelsConfig,
  type ProviderAccessMap,
} from '../../../fixtures/settings-models'
import {
  CATALOGUE_MODELS,
  type CatalogueModel,
  type CatalogueRow,
} from '../../../fixtures/settings-models-catalogue'
import { modelUsers } from './model-state'
import { ERouteKind, servedBy, viasFor, type Via } from './model-routes'

export enum ECatalogueRoute {
  Connected = 'connected',
  Unconnected = 'unconnected',
}

export type RouteFilter = ECatalogueRoute | EProviderId

export const PAGE_SIZE = 20

export type CatalogueEntry = {
  model: CatalogueModel
  row: CatalogueRow
  vias: Via[]
  used: Via | null
  users: EAgentRole[]
}

export type CatalogueSummary = { total: number; viaSubscription: number }

export function buildEntries({
  access,
  config,
}: {
  access: ProviderAccessMap
  config: ModelsConfig
}): CatalogueEntry[] {
  return CATALOGUE_MODELS.flatMap((model) => {
    const row = model.rows[0]
    if (!row) return []
    const vias = viasFor({ model, access })
    const used = servedBy({ model, access })
    return [
      { model, row: used?.row ?? row, vias, used, users: modelUsers({ model, config, access }) },
    ]
  })
}

export function summarize(entries: CatalogueEntry[]): CatalogueSummary {
  return {
    total: entries.length,
    viaSubscription: entries.filter((entry) => entry.used?.kind === ERouteKind.Plan).length,
  }
}

const CAPABILITY_TESTS: Record<EModelFilter, (entry: CatalogueEntry) => boolean> = {
  [EModelFilter.Images]: (entry) => entry.row.images,
  [EModelFilter.Reasoning]: (entry) => entry.row.efforts.length > 0,
  [EModelFilter.LongContext]: (entry) => entry.row.contextWindow >= LONG_CONTEXT_TOKENS,
}

function inRoute({ entry, route }: { entry: CatalogueEntry; route: RouteFilter }): boolean {
  if (route === ECatalogueRoute.Connected) return entry.vias.length > 0
  if (route === ECatalogueRoute.Unconnected) return entry.vias.length === 0
  return entry.vias.some((via) => via.provider === route)
}

function searchText(entry: CatalogueEntry): string {
  const providers = entry.model.rows.map((row) => PROVIDER_LABELS[row.provider])
  const routes = entry.vias.map((via) => via.label)
  return [entry.model.label, entry.model.key, ...providers, ...routes].join(' ')
}

function rank({ entry, pinned }: { entry: CatalogueEntry; pinned: Set<string> }): number {
  if (pinned.has(entry.model.key)) return 0
  return entry.used?.kind === ERouteKind.Plan ? 1 : 2
}

export function filterEntries({
  entries,
  query,
  route,
  capabilities,
  pinned,
}: {
  entries: CatalogueEntry[]
  query: string
  route: RouteFilter
  capabilities: EModelFilter[]
  pinned: string[]
}): CatalogueEntry[] {
  const terms = queryTerms(query)
  const pinnedSet = new Set(pinned)
  return entries
    .filter(
      (entry) =>
        inRoute({ entry, route }) &&
        capabilities.every((capability) => CAPABILITY_TESTS[capability](entry)) &&
        includesAll({ text: searchText(entry), terms }),
    )
    .map((entry, index) => ({ entry, index, rank: rank({ entry, pinned: pinnedSet }) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry)
}

export function visibleCount({
  entries,
  pinned,
  pages,
}: {
  entries: CatalogueEntry[]
  pinned: string[]
  pages: number
}): number {
  const pinnedSet = new Set(pinned)
  const pinnedShown = entries.filter((entry) => pinnedSet.has(entry.model.key)).length
  return Math.min(entries.length, pinnedShown + PAGE_SIZE * pages)
}
