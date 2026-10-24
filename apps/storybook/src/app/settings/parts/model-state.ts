import { EEffort, EFFORT_LADDER, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import {
  AUTO_MODEL,
  ROLE_META,
  ROLE_ORDER,
  type EAgentRole,
  type ModelsConfig,
  type ProviderAccessMap,
} from '@dltech/atlas-ui/fixtures/settings-models'
import {
  CATALOGUE_MODELS,
  MODEL_BY_KEY,
  MODEL_BY_REF,
  ROW_BY_REF,
  contextLabel,
  familyMark,
  priceLabel,
  type CatalogueModel,
  type CatalogueRow,
} from '@dltech/atlas-ui/fixtures/settings-models-catalogue'
import {
  EReach,
  ERouteKind,
  PROVIDER_PRECEDENCE,
  expiredProviders,
  routeFor,
  servedBy,
  type Route,
} from './model-routes'

export type Resolved = {
  model: CatalogueModel
  row: CatalogueRow
  route: Route
  auto: boolean
}

export function clampEffort({
  efforts,
  effort,
}: {
  efforts: EEffort[]
  effort: EEffort
}): EEffort | null {
  if (efforts.includes(effort)) return effort
  const asked = EFFORT_LADDER.indexOf(effort)
  const above = efforts.find((offered) => EFFORT_LADDER.indexOf(offered) > asked)
  return above ?? efforts[efforts.length - 1] ?? null
}

function resolveAuto({
  role,
  config,
  access,
}: {
  role: EAgentRole
  config: ModelsConfig
  access: ProviderAccessMap
}): Resolved | null {
  const meta = ROLE_META[role]
  const followed = meta.follows ? resolveRoleModel({ role: meta.follows, config, access }) : null
  if (followed && followed.route.reach === EReach.Ready) return { ...followed, auto: true }
  const candidates = meta.autoOrder.flatMap((key) => MODEL_BY_KEY.get(key) ?? [])
  for (const model of [...candidates, ...CATALOGUE_MODELS]) {
    const via = servedBy({ model, access })
    if (via) return { model, row: via.row, route: via, auto: true }
  }
  return null
}

export function resolveRoleModel({
  role,
  config,
  access,
}: {
  role: EAgentRole
  config: ModelsConfig
  access: ProviderAccessMap
}): Resolved | null {
  const { model: ref } = config[role]
  if (ref === AUTO_MODEL) return resolveAuto({ role, config, access })
  const row = ROW_BY_REF.get(ref)
  const model = MODEL_BY_REF.get(ref)
  if (!row || !model) return null
  return { model, row, route: routeFor({ provider: row.provider, access }), auto: false }
}

export function effortFor({
  resolved,
  effort,
}: {
  resolved: Resolved | null
  effort: EEffort
}): EEffort | null {
  return resolved ? clampEffort({ efforts: resolved.row.efforts, effort }) : null
}

export function changeRoleModel({
  config,
  role,
  model,
  access,
}: {
  config: ModelsConfig
  role: EAgentRole
  model: string
  access: ProviderAccessMap
}): ModelsConfig {
  const draft = { ...config, [role]: { ...config[role], model } }
  const resolved = resolveRoleModel({ role, config: draft, access })
  const effort = effortFor({ resolved, effort: config[role].effort }) ?? config[role].effort
  return { ...draft, [role]: { model, effort } }
}

export function modelUsers({
  model,
  config,
  access,
}: {
  model: CatalogueModel
  config: ModelsConfig
  access: ProviderAccessMap
}): EAgentRole[] {
  return ROLE_ORDER.filter(
    (role) => resolveRoleModel({ role, config, access })?.model.key === model.key,
  )
}

export function pinnedRefs({
  pinned,
  access,
}: {
  pinned: string[]
  access: ProviderAccessMap
}): string[] {
  return pinned.flatMap((key) => {
    const model = MODEL_BY_KEY.get(key)
    if (!model) return []
    return [servedBy({ model, access })?.row.ref ?? model.rows[0]?.ref ?? key]
  })
}

export function pinnedKeys(refs: string[]): string[] {
  return refs.flatMap((ref) => MODEL_BY_REF.get(ref)?.key ?? [])
}

function toOption({ row, route }: { row: CatalogueRow; route: Route }): ModelOption {
  const mark = familyMark(MODEL_BY_REF.get(row.ref)?.vendor ?? '')
  return {
    id: row.ref,
    label: row.label,
    provider: route.label,
    route: route.short,
    context: contextLabel(row.contextWindow),
    contextTokens: row.contextWindow,
    rate: route.kind === ERouteKind.Key ? priceLabel(row.cost) : undefined,
    images: row.images,
    efforts: row.efforts,
    brand: mark.brand,
    monogram: mark.monogram,
  }
}

export function catalogueOptions(access: ProviderAccessMap): ModelOption[] {
  return PROVIDER_PRECEDENCE.flatMap((provider) => {
    const route = routeFor({ provider, access })
    if (route.reach === EReach.Missing) return []
    return CATALOGUE_MODELS.flatMap((model) => {
      const row = model.rows.find((candidate) => candidate.provider === provider)
      return row ? [toOption({ row, route })] : []
    })
  })
}

export function collapsedRouteLabels(access: ProviderAccessMap): string[] {
  return PROVIDER_PRECEDENCE.flatMap((provider) => {
    const route = routeFor({ provider, access })
    return route.kind === ERouteKind.Key ? [route.label] : []
  })
}

export function reconnectInfo(access: ProviderAccessMap): {
  providers: string[]
  notes: Record<string, string>
} {
  const labels = expiredProviders(access).map((provider) => routeFor({ provider, access }).label)
  return {
    providers: labels,
    notes: Object.fromEntries(labels.map((label) => [label, `${label} sign-in expired`])),
  }
}
