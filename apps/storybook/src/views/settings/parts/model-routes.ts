import { EProviderId } from '@dltech/atlas-ui/fixtures/settings-agent'
import {
  EConnectionStatus,
  type ProviderAccessMap,
} from '@dltech/atlas-ui/fixtures/settings-models'
import type {
  CatalogueModel,
  CatalogueRow,
} from '@dltech/atlas-ui/fixtures/settings-models-catalogue'

export enum EReach {
  Ready = 'ready',
  Expired = 'expired',
  Missing = 'missing',
}

export enum ERouteKind {
  Plan = 'plan',
  Key = 'key',
  None = 'none',
}

export type Route = { reach: EReach; kind: ERouteKind; label: string; short: string }

export type Via = Route & { provider: EProviderId; row: CatalogueRow }

export const PROVIDER_PRECEDENCE: EProviderId[] = [
  EProviderId.Anthropic,
  EProviderId.OpenAI,
  EProviderId.OpenRouter,
  EProviderId.Inference,
  EProviderId.Gateway,
]

const MISSING_ROUTE: Route = { reach: EReach.Missing, kind: ERouteKind.None, label: '', short: '' }

export function routesFor({
  provider,
  access,
}: {
  provider: EProviderId
  access: ProviderAccessMap
}): Route[] {
  const entry = access[provider]
  if (!entry) return []
  const routes: Route[] = []
  if (entry.plan) {
    routes.push({
      reach: entry.plan.status === EConnectionStatus.Active ? EReach.Ready : EReach.Expired,
      kind: ERouteKind.Plan,
      label: entry.plan.label,
      short: entry.plan.short,
    })
  }
  if (entry.key) {
    routes.push({
      reach: EReach.Ready,
      kind: ERouteKind.Key,
      label: entry.key.label,
      short: entry.key.short,
    })
  }
  return routes
}

export function routeFor({
  provider,
  access,
}: {
  provider: EProviderId
  access: ProviderAccessMap
}): Route {
  const routes = routesFor({ provider, access })
  return routes.find((route) => route.reach === EReach.Ready) ?? routes[0] ?? MISSING_ROUTE
}

export function viasFor({
  model,
  access,
}: {
  model: CatalogueModel
  access: ProviderAccessMap
}): Via[] {
  return PROVIDER_PRECEDENCE.flatMap((provider) => {
    const row = model.rows.find((candidate) => candidate.provider === provider)
    if (!row) return []
    return routesFor({ provider, access }).map((route) => ({ ...route, provider, row }))
  })
}

export function servedBy({
  model,
  access,
}: {
  model: CatalogueModel
  access: ProviderAccessMap
}): Via | null {
  return viasFor({ model, access }).find((via) => via.reach === EReach.Ready) ?? null
}

export function expiredProviders(access: ProviderAccessMap): EProviderId[] {
  return PROVIDER_PRECEDENCE.filter(
    (provider) => routeFor({ provider, access }).reach === EReach.Expired,
  )
}

export function hasAnyRoute(access: ProviderAccessMap): boolean {
  return PROVIDER_PRECEDENCE.some(
    (provider) => routeFor({ provider, access }).reach !== EReach.Missing,
  )
}
