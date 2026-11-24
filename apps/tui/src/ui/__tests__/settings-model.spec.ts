import {
  ATLAS_SETTINGS,
  agentTypeDefinitions,
  EDefinitionOrigin,
  agentTypeEffortSettingId,
  agentTypeFastSettingId,
  agentTypeSettingId,
  ESettingId,
  ESettingPage,
  ESettingKind,
  ESettingsLayer,
  resolveSettings,
  type SettingDefinition,
  type SettingsLayerInput,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  currentRow,
  movePage,
  moveRow,
  openSettings,
  settingsModel,
  type SettingsModel,
} from '../settings-model'

const builtIn = (names: readonly string[]) =>
  names.map((name) => ({ name, origin: EDefinitionOrigin.BuiltIn }))

const modelWith = (layers: readonly SettingsLayerInput[] = []): SettingsModel =>
  settingsModel({
    definitions: ATLAS_SETTINGS,
    resolution: resolveSettings({ definitions: ATLAS_SETTINGS, layers }),
  })

describe('settingsModel', () => {
  it('keeps only the pages that have something on them, plus the cloud page', () => {
    const model = modelWith()

    expect(model.pages.map((page) => page.page.label)).toEqual([
      'general',
      'models',
      'appearance',
      'experimental',
      'cloud',
      'quality',
    ])
  })

  it('keeps the cloud page even when nothing resolves onto it', () => {
    const model = settingsModel({
      definitions: [],
      resolution: resolveSettings({ definitions: [], layers: [] }),
    })

    expect(model.pages.map((page) => page.page.id)).toEqual([ESettingPage.Cloud])
    expect(model.pages[0]?.rows).toEqual([])
  })

  it('gathers consecutive rows under one group heading', () => {
    const general = modelWith().pages[0]

    expect(general?.groups.map((group) => [group.label, group.rows.length])).toEqual([
      ['Transcript', 2],
      ['Layout', 1],
      ['Skills', 1],
      ['Context window', 1],
      ['Worktrees', 1],
      ['Nudges', 1],
      ['Web', 2],
      ['Images', 1],
    ])
    expect(general?.rows).toHaveLength(10)
  })

  it('leaves the cloud page to the definitions the harness adds', () => {
    const cloud = modelWith().pages.find((page) => page.page.id === ESettingPage.Cloud)

    expect(cloud?.page.id).toBe(ESettingPage.Cloud)
    expect(cloud?.rows).toEqual([])
  })

  it('gathers the model rows on the models page, default pair first', () => {
    const models = modelWith().pages[1]

    expect(models?.page.id).toBe(ESettingPage.Models)
    expect(models?.groups.map((group) => [group.label, group.rows.length])).toEqual([
      ['Model', 3],
      ['Background processes', 9],
    ])
    expect(models?.rows.map((row) => row.definition.id)).toEqual([
      ESettingId.ModelId,
      ESettingId.ModelEffort,
      ESettingId.ModelFast,
      ESettingId.QuickModel,
      ESettingId.QuickEffort,
      ESettingId.QuickFast,
      ESettingId.CompactionModel,
      ESettingId.CompactionEffort,
      ESettingId.CompactionFast,
      ESettingId.SubagentModel,
      ESettingId.SubagentEffort,
      ESettingId.SubagentFast,
    ])
  })

  it('groups a late-registered teammate with the main model and keeps navigation in visual order', () => {
    const definitions = [
      ...ATLAS_SETTINGS,
      ...agentTypeDefinitions({
        effortRungsOf: () => undefined,
        types: builtIn(['builder', 'teammate', 'explore']),
      }),
    ]
    const model = settingsModel({
      definitions,
      resolution: resolveSettings({ definitions, layers: [] }),
    })
    const models = model.pages.find((page) => page.page.id === ESettingPage.Models)

    expect(models?.groups.map((group) => [group.label, group.rows.length])).toEqual([
      ['Model', 6],
      ['Background processes', 9],
      ['Built-in sub-agents', 6],
    ])
    expect(models?.rows.map((row) => row.definition.id)).toEqual([
      ESettingId.ModelId,
      ESettingId.ModelEffort,
      ESettingId.ModelFast,
      agentTypeSettingId('teammate'),
      agentTypeEffortSettingId('teammate'),
      agentTypeFastSettingId('teammate'),
      ESettingId.QuickModel,
      ESettingId.QuickEffort,
      ESettingId.QuickFast,
      ESettingId.CompactionModel,
      ESettingId.CompactionEffort,
      ESettingId.CompactionFast,
      ESettingId.SubagentModel,
      ESettingId.SubagentEffort,
      ESettingId.SubagentFast,
      agentTypeSettingId('builder'),
      agentTypeEffortSettingId('builder'),
      agentTypeFastSettingId('builder'),
      agentTypeSettingId('explore'),
      agentTypeEffortSettingId('explore'),
      agentTypeFastSettingId('explore'),
    ])
    expect(currentRow({ state: { pageIndex: 1, rowIndex: 3 }, model })?.definition.id).toBe(
      agentTypeSettingId('teammate'),
    )
  })

  it('keeps the appearance page to its colour, its density, its composer and its logo', () => {
    const appearance = modelWith().pages[2]

    expect(appearance?.groups.map((group) => group.label)).toEqual([
      'Colour',
      'Density',
      'Composer',
      'Logo',
    ])
    expect(appearance?.rows).toHaveLength(4)
  })

  it('carries where each value came from onto the row', () => {
    const model = modelWith([
      {
        layer: ESettingsLayer.Environment,
        origin: 'environment',
        values: { [ESettingId.Accent]: 'moss' },
        origins: { [ESettingId.Accent]: 'ATLAS_ACCENT' },
      },
    ])
    const appearance = model.pages[2]

    expect(appearance?.rows[0]?.value).toBe('moss')
    expect(appearance?.rows[0]?.origin).toBe('ATLAS_ACCENT')
  })
})

describe('moving around the page', () => {
  const model = modelWith()

  it('stops at the ends of a page rather than wrapping rows', () => {
    const top = openSettings()

    expect(moveRow({ state: top, model, delta: -1 })).toEqual({ pageIndex: 0, rowIndex: 0 })
    expect(moveRow({ state: top, model, delta: 99 })).toEqual({ pageIndex: 0, rowIndex: 9 })
  })

  it('wraps around the tab strip and lands on its first row', () => {
    const last = model.pages.length - 1
    const moved = movePage({ state: { pageIndex: 0, rowIndex: 1 }, model, delta: 1 })

    expect(moved).toEqual({ pageIndex: 1, rowIndex: 0 })
    expect(movePage({ state: moved, model, delta: 1 })).toEqual({ pageIndex: 2, rowIndex: 0 })
    expect(movePage({ state: { pageIndex: last, rowIndex: 0 }, model, delta: 1 })).toEqual({
      pageIndex: 0,
      rowIndex: 0,
    })
    expect(movePage({ state: openSettings(), model, delta: -1 })).toEqual({
      pageIndex: last,
      rowIndex: 0,
    })
  })

  it('names the row the keys would act on', () => {
    expect(currentRow({ state: openSettings(), model })?.definition.id).toBe(ESettingId.ImageRows)
    expect(currentRow({ state: { pageIndex: 1, rowIndex: 0 }, model })?.definition.id).toBe(
      ESettingId.ModelId,
    )
    expect(currentRow({ state: { pageIndex: 2, rowIndex: 0 }, model })?.definition.id).toBe(
      ESettingId.Accent,
    )
  })
})

describe('conditional rows', () => {
  const conditional = (visible: boolean): SettingDefinition => ({
    id: 'demo.conditional',
    page: ESettingPage.General,
    group: 'Demo',
    label: 'Conditional',
    description: 'x',
    kind: ESettingKind.Toggle,
    fallback: false,
    visibleWhen: () => visible,
  })

  const modelOf = (visible: boolean): SettingsModel => {
    const definitions = [...ATLAS_SETTINGS, conditional(visible)]
    return settingsModel({
      definitions,
      resolution: resolveSettings({ definitions, layers: [] }),
    })
  }

  it('shows a conditional row when its predicate says so', () => {
    const general = modelOf(true).pages[0]

    expect(general?.rows.map((row) => row.definition.id)).toContain('demo.conditional')
  })

  it('never lets a hidden row reach the groups or the navigation list', () => {
    const general = modelOf(false).pages[0]
    const flat = general?.groups.flatMap((group) => group.rows).length

    expect(general?.rows.some((row) => row.definition.id === 'demo.conditional')).toBe(false)
    expect(flat).toBe(general?.rows.length ?? -1)
  })

  it('leaves the cursor on a real row when the list shrinks under it', () => {
    const grown = modelOf(true)
    const shrunk = modelOf(false)
    const stranded = { pageIndex: 0, rowIndex: (grown.pages[0]?.rows.length ?? 1) - 1 }
    const moved = moveRow({ state: stranded, model: shrunk, delta: 0 })

    expect(currentRow({ state: stranded, model: grown })?.definition.id).toBe('demo.conditional')
    expect(currentRow({ state: moved, model: shrunk })?.definition.id).toBe(
      shrunk.pages[0]?.rows.at(-1)?.definition.id,
    )
  })

  it('still renders the other groups when every row of one group is hidden', () => {
    const only: SettingDefinition = {
      id: 'demo.hidden',
      page: ESettingPage.General,
      group: 'Hidden group',
      label: 'x',
      description: 'x',
      kind: ESettingKind.Toggle,
      fallback: true,
      visibleWhen: () => false,
    }
    const definitions = [...ATLAS_SETTINGS, only]
    const general = settingsModel({
      definitions,
      resolution: resolveSettings({ definitions, layers: [] }),
    }).pages[0]

    expect(general?.groups.map((group) => group.label)).not.toContain('Hidden group')
    expect(general?.groups.length).toBeGreaterThan(1)
  })
})
