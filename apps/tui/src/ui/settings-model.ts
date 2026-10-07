import {
  agentTypeModelDefinitions,
  agentTypeModelGroup,
  DEFAULT_LAYER_ORIGIN,
  definitionsOfPage,
  EDefinitionOrigin,
  ESettingKind,
  ESettingPage,
  ESettingsLayer,
  SETTING_PAGES,
  type AgentTypeModelSource,
  type ResolvedSetting,
  type SettingDefinition,
  type SettingPage,
  type SettingsResolution,
} from '@dltech/atlas-core'

export type SettingsRow = ResolvedSetting & { writeOrigin?: string | undefined }

export type ShadowedAgentTypeSource = {
  name: string
  origin: EDefinitionOrigin
  definedIn: string | undefined
  shadowedBy: EDefinitionOrigin
}

export type SettingsGroup = {
  label: string
  rows: readonly SettingsRow[]
}

export type SettingsPageModel = {
  page: SettingPage
  groups: readonly SettingsGroup[]
  rows: readonly SettingsRow[]
}

export type SettingsModel = {
  pages: readonly SettingsPageModel[]
}

export type SettingsState = {
  pageIndex: number
  rowIndex: number
}

const wrapped = (args: { index: number; length: number }): number => {
  if (args.length === 0) return 0
  return ((args.index % args.length) + args.length) % args.length
}

const clamped = (args: { index: number; length: number }): number =>
  Math.min(Math.max(0, args.index), Math.max(0, args.length - 1))

const agentTypeOf = (setting: ResolvedSetting): AgentTypeModelSource | undefined =>
  setting.definition.kind === ESettingKind.Model ? setting.definition.agentType : undefined

export const isOverriddenSetting = (setting: ResolvedSetting): boolean =>
  agentTypeOf(setting)?.overriddenBy !== undefined

export function settingRowKey(setting: ResolvedSetting): string {
  const agentType = agentTypeOf(setting)
  if (agentType?.overriddenBy === undefined) return setting.definition.id
  return `shadow:${setting.definition.id}:${agentType.origin}:${agentType.definedIn ?? ''}`
}

const AGENT_GROUP_ORDER: readonly string[] = [
  EDefinitionOrigin.BuiltIn,
  EDefinitionOrigin.User,
  EDefinitionOrigin.Project,
].map(agentTypeModelGroup)

const compareAgentRows = (left: ResolvedSetting, right: ResolvedSetting): number => {
  const leftType = agentTypeOf(left)
  const rightType = agentTypeOf(right)
  return (
    (leftType?.name ?? '').localeCompare(rightType?.name ?? '') ||
    (leftType?.definedIn ?? '').localeCompare(rightType?.definedIn ?? '') ||
    Number(isOverriddenSetting(left)) - Number(isOverriddenSetting(right))
  )
}

const agentGroupsLast = (groups: readonly SettingsGroup[]): readonly SettingsGroup[] => {
  const agentGroups = AGENT_GROUP_ORDER.flatMap((label) => {
    const held = groups.find((group) => group.label === label)
    return held === undefined ? [] : [{ label, rows: [...held.rows].sort(compareAgentRows) }]
  })
  return [...groups.filter((group) => !AGENT_GROUP_ORDER.includes(group.label)), ...agentGroups]
}

const shadowRowsOf = (shadows: readonly ShadowedAgentTypeSource[]): readonly SettingsRow[] =>
  shadows.flatMap((shadow) =>
    agentTypeModelDefinitions({
      types: [
        {
          name: shadow.name,
          origin: shadow.origin,
          definedIn: shadow.definedIn,
          overriddenBy: shadow.shadowedBy,
        },
      ],
    }).map((definition) => ({
      definition,
      value: definition.fallback,
      layer: ESettingsLayer.Default,
      origin: DEFAULT_LAYER_ORIGIN,
    })),
  )

const groupsOf = (rows: readonly SettingsRow[]): readonly SettingsGroup[] => {
  const groups: SettingsGroup[] = []

  for (const row of rows) {
    const index = groups.findIndex((group) => group.label === row.definition.group)
    const group = groups[index]
    if (group !== undefined) {
      groups[index] = { label: group.label, rows: [...group.rows, row] }
      continue
    }
    groups.push({ label: row.definition.group, rows: [row] })
  }

  return groups
}

const resolvedOf = (args: {
  definitions: readonly SettingDefinition[]
  resolution: SettingsResolution
  writeOriginOf?: ((id: string) => string | undefined) | undefined
}): readonly SettingsRow[] => {
  const rows: SettingsRow[] = []
  for (const definition of args.definitions) {
    const held = args.resolution.settings.get(definition.id)
    if (held === undefined) continue
    rows.push(args.writeOriginOf === undefined ? held : { ...held, writeOrigin: args.writeOriginOf(definition.id) })
  }
  return rows
}

const keepsEmptyPage = (page: SettingPage): boolean => page.id === ESettingPage.Cloud

export function settingsModel(args: {
  definitions: readonly SettingDefinition[]
  resolution: SettingsResolution
  pages?: readonly SettingPage[]
  shadowedAgentTypes?: readonly ShadowedAgentTypeSource[]
  writeOriginOf?: (id: string) => string | undefined
}): SettingsModel {
  const pages: SettingsPageModel[] = []

  for (const page of args.pages ?? SETTING_PAGES) {
    const rows = [
      ...resolvedOf({
        definitions: definitionsOfPage({ definitions: args.definitions, page: page.id }),
        resolution: args.resolution,
        writeOriginOf: args.writeOriginOf,
      }),
      ...(page.id === ESettingPage.Models ? shadowRowsOf(args.shadowedAgentTypes ?? []) : []),
    ]
    if (rows.length === 0 && !keepsEmptyPage(page)) continue

    const groups = agentGroupsLast(groupsOf(rows))
    pages.push({ page, groups, rows: groups.flatMap((group) => group.rows) })
  }

  return { pages }
}

export const openSettings = (): SettingsState => ({ pageIndex: 0, rowIndex: 0 })

export function currentPage(args: {
  state: SettingsState
  model: SettingsModel
}): SettingsPageModel | undefined {
  return args.model.pages[args.state.pageIndex]
}

export function currentRow(args: {
  state: SettingsState
  model: SettingsModel
}): SettingsRow | undefined {
  return currentPage(args)?.rows[args.state.rowIndex]
}

export function movePage(args: {
  state: SettingsState
  model: SettingsModel
  delta: number
}): SettingsState {
  const pageIndex = wrapped({
    index: args.state.pageIndex + Math.trunc(args.delta),
    length: args.model.pages.length,
  })

  return { pageIndex, rowIndex: 0 }
}

export function moveRow(args: {
  state: SettingsState
  model: SettingsModel
  delta: number
}): SettingsState {
  const page = currentPage(args)
  if (page === undefined) return args.state

  return {
    pageIndex: args.state.pageIndex,
    rowIndex: clamped({
      index: args.state.rowIndex + Math.trunc(args.delta),
      length: page.rows.length,
    }),
  }
}
