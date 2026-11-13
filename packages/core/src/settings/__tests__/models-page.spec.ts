import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '../../discovery/origin'
import { EEffort, EFFORT_LADDER } from '../../models/effort-ladder'
import {
  agentTypeDefinitions,
  agentTypeEffortSettingId,
  agentTypeFastSettingId,
  agentTypeSettingId,
} from '../agent-type-rows'
import { ESettingsLayer } from '../layers'
import {
  definitionsOfPage,
  ESettingPage,
  isSettingVisible,
  type ChoiceDefinition,
} from '../definition'
import { ATLAS_SETTINGS, ESettingId, SETTING_PAGES } from '../registry'
import { resolveSettings } from '../resolve'
import { ESettingKind } from '../value'

const modelsRows = () =>
  definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Models })

describe('the models settings page', () => {
  it('sits between general and appearance', () => {
    expect(SETTING_PAGES.map((page) => page.id)).toEqual([
      ESettingPage.General,
      ESettingPage.Models,
      ESettingPage.Appearance,
      ESettingPage.Experimental,
      ESettingPage.Cloud,
      ESettingPage.CodeQuality,
    ])
  })

  it('holds the default pair first, then the background roles, then the decisions group', () => {
    expect(modelsRows().map((row) => row.id)).toEqual([
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
      ESettingId.DecisionsProvider,
      ESettingId.DecisionsUrl,
      ESettingId.DecisionsModel,
      ESettingId.DecisionsToken,
    ])
  })

  it('keeps every model row on the models page and off general', () => {
    const general = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.General })

    expect(general.some((row) => row.kind === ESettingKind.Model)).toBe(false)
    const nonModelKinds = new Set<string>([
      ESettingId.ModelEffort,
      ESettingId.SubagentEffort,
      ESettingId.ModelFast,
      ESettingId.QuickEffort,
      ESettingId.QuickFast,
      ESettingId.CompactionEffort,
      ESettingId.CompactionFast,
      ESettingId.SubagentFast,
    ])

    expect(
      modelsRows()
        .filter((row) => row.group !== 'Decisions')
        .every((row) => row.kind === ESettingKind.Model || nonModelKinds.has(row.id)),
    ).toBe(true)
  })

  it('gives every model row an environment variable override', () => {
    for (const row of modelsRows().filter((one) => one.kind !== ESettingKind.Secret)) {
      expect(row.environmentVariable).toBeDefined()
    }
  })
})

describe('the background role effort and fast rows', () => {
  const rowOf = (id: ESettingId) => modelsRows().find((row) => row.id === id)

  it('offers an effort choice with inherit for quick calls and compaction', () => {
    for (const id of [ESettingId.QuickEffort, ESettingId.CompactionEffort]) {
      const row = rowOf(id) as ChoiceDefinition
      expect(row.kind).toBe(ESettingKind.Choice)
      expect(row.group).toBe('Background processes')
      expect(row.fallback).toBe('')
      expect(row.options.map((option) => option.value)).toEqual(['', ...EFFORT_LADDER])
    }
  })

  it('offers a fast toggle that starts off for quick calls, compaction and sub-agents', () => {
    for (const id of [ESettingId.QuickFast, ESettingId.CompactionFast, ESettingId.SubagentFast]) {
      const row = rowOf(id)
      expect(row?.kind).toBe(ESettingKind.Toggle)
      expect(row?.group).toBe('Background processes')
      expect(row?.fallback).toBe(false)
    }
  })

  it('describes what each row does rather than what it will do', () => {
    for (const id of [
      ESettingId.QuickEffort,
      ESettingId.QuickFast,
      ESettingId.CompactionEffort,
      ESettingId.CompactionFast,
      ESettingId.SubagentFast,
    ]) {
      const description = rowOf(id)?.description ?? ''
      expect(description.length).toBeGreaterThan(40)
      expect(description).not.toContain('not wired')
    }
  })
})

describe('agentTypeDefinitions', () => {
  const noRungs = () => undefined

  const builtIn = (name: string) => ({ name, origin: EDefinitionOrigin.BuiltIn })

  const resolutionOf = (args: {
    definitions: ReturnType<typeof agentTypeDefinitions>
    values: Record<string, unknown>
  }) =>
    resolveSettings({
      definitions: [...ATLAS_SETTINGS, ...args.definitions],
      layers: [{ layer: ESettingsLayer.User, origin: 'test', values: args.values }],
    })

  it('builds a model row, an effort row and a fast row per built-in type, model first', () => {
    const definitions = agentTypeDefinitions({
      types: [builtIn('explore'), builtIn('builder')],
      effortRungsOf: noRungs,
    })

    expect(definitions.map((definition) => definition.id)).toEqual([
      'agents.type.explore',
      'agents.type.explore.effort',
      'agents.type.explore.fast',
      'agents.type.builder',
      'agents.type.builder.effort',
      'agents.type.builder.fast',
    ])
    expect(definitions.map((definition) => definition.kind)).toEqual([
      ESettingKind.Model,
      ESettingKind.Choice,
      ESettingKind.Toggle,
      ESettingKind.Model,
      ESettingKind.Choice,
      ESettingKind.Toggle,
    ])
    for (const definition of definitions) {
      expect(definition.page).toBe(ESettingPage.Models)
      expect(definition.group).toBe('Built-in sub-agents')
      expect(definition.fallback).toBe(definition.kind === ESettingKind.Toggle ? false : '')
    }
    const effort = definitions[1] as ChoiceDefinition
    expect(effort.label).toBe('explore effort')
    expect(effort.options.map((option) => option.value)).toEqual(['', ...EFFORT_LADDER])
    expect(definitions[2]?.label).toBe('explore fast mode')
    expect(definitions[2]?.fallback).toBe(false)
  })

  it('places teammates with the main model and inherits the main agent', () => {
    const [model, effort, fast] = agentTypeDefinitions({
      types: [builtIn('teammate')],
      effortRungsOf: noRungs,
    })

    expect(model?.id).toBe('agents.type.teammate')
    expect(model?.page).toBe(ESettingPage.Models)
    expect(model?.group).toBe('Model')
    expect(model?.label).toBe('Teammates')
    expect(model?.kind === ESettingKind.Model ? model.unsetLabel : undefined).toBe(
      'follow main agent',
    )
    expect(model?.description).toContain("main agent's current model and effort")

    expect(effort?.id).toBe(agentTypeEffortSettingId('teammate'))
    expect(effort?.group).toBe('Model')
    expect(effort?.label).toBe('Teammates effort')
    expect(effort?.description).toContain('main agent')

    expect(fast?.id).toBe(agentTypeFastSettingId('teammate'))
    expect(fast?.group).toBe('Model')
    expect(fast?.label).toBe('Teammates fast mode')
    expect(fast?.description).toContain('fast mode')
  })

  it('retains provenance and scopes repository choices to project settings', () => {
    const types = [
      {
        name: 'reviewer',
        origin: EDefinitionOrigin.Project,
        definedIn: '/repo/.atlas/agents/reviewer.md',
      },
      {
        name: 'auditor',
        origin: EDefinitionOrigin.User,
        definedIn: '/home/.atlas/agents/auditor.md',
      },
      builtIn('builder'),
    ]
    const definitions = agentTypeDefinitions({ types, effortRungsOf: noRungs })

    expect(definitions.map((definition) => definition.group)).toEqual([
      'Repository-defined sub-agents',
      'Repository-defined sub-agents',
      'Repository-defined sub-agents',
      'Global user-defined sub-agents',
      'Global user-defined sub-agents',
      'Global user-defined sub-agents',
      'Built-in sub-agents',
      'Built-in sub-agents',
      'Built-in sub-agents',
    ])
    expect(definitions.map((definition) => definition.agentType)).toEqual([
      types[0],
      types[0],
      types[0],
      types[1],
      types[1],
      types[1],
      types[2],
      types[2],
      types[2],
    ])
    expect(definitions.map((definition) => definition.writeLayer)).toEqual([
      ESettingsLayer.Project,
      ESettingsLayer.Project,
      ESettingsLayer.Project,
      ESettingsLayer.User,
      ESettingsLayer.User,
      ESettingsLayer.User,
      ESettingsLayer.User,
      ESettingsLayer.User,
      ESettingsLayer.User,
    ])
  })

  it('retains the overriding origin for display-only definitions', () => {
    const [model, effort] = agentTypeDefinitions({
      types: [
        {
          name: 'reviewer',
          origin: EDefinitionOrigin.BuiltIn,
          overriddenBy: EDefinitionOrigin.Project,
        },
      ],
      effortRungsOf: noRungs,
    })

    expect(model?.agentType?.overriddenBy).toBe(EDefinitionOrigin.Project)
    expect(model?.id).toBe('agents.type.reviewer')
    expect(effort?.agentType?.overriddenBy).toBe(EDefinitionOrigin.Project)
  })

  it('derives stable ids from the type name', () => {
    expect(agentTypeSettingId('general-purpose')).toBe('agents.type.general-purpose')
    expect(agentTypeEffortSettingId('general-purpose')).toBe('agents.type.general-purpose.effort')
    expect(agentTypeFastSettingId('general-purpose')).toBe('agents.type.general-purpose.fast')
  })

  it('offers the rungs of the model the type will actually run on', () => {
    const definitions = agentTypeDefinitions({
      types: [builtIn('explore')],
      effortRungsOf: (modelId) =>
        modelId === 'anthropic/claude-opus-5' ? [EEffort.Low, EEffort.High] : undefined,
    })
    const effort = definitions[1] as ChoiceDefinition

    const own = resolutionOf({
      definitions,
      values: { 'agents.type.explore': 'anthropic/claude-opus-5' },
    })
    expect(effort.optionsFor?.({ resolution: own }).map((option) => option.value)).toEqual([
      '',
      EEffort.Low,
      EEffort.High,
    ])

    const shared = resolutionOf({
      definitions,
      values: { 'agents.subagentModel': 'anthropic/claude-opus-5' },
    })
    expect(effort.optionsFor?.({ resolution: shared }).map((option) => option.value)).toEqual([
      '',
      EEffort.Low,
      EEffort.High,
    ])

    const none = resolutionOf({ definitions, values: {} })
    expect(effort.optionsFor?.({ resolution: none }).map((option) => option.value)).toEqual([
      '',
      ...EFFORT_LADDER,
    ])
  })

  it('ignores the sub-agent model for a teammate, which follows the main agent', () => {
    const definitions = agentTypeDefinitions({
      types: [builtIn('teammate')],
      effortRungsOf: (modelId) => (modelId === 'openai/gpt-5-mini' ? [EEffort.Low] : undefined),
    })
    const effort = definitions[1] as ChoiceDefinition
    const resolution = resolutionOf({
      definitions,
      values: { 'agents.subagentModel': 'openai/gpt-5-mini' },
    })

    expect(effort.optionsFor?.({ resolution }).map((option) => option.value)).toEqual([
      '',
      ...EFFORT_LADDER,
    ])
  })

  it('hides the effort row when the model takes no effort at all', () => {
    const definitions = agentTypeDefinitions({
      types: [builtIn('explore')],
      effortRungsOf: (modelId) => (modelId === 'openai/gpt-5-mini' ? [] : undefined),
    })
    const effort = definitions[1]

    const noBudget = resolutionOf({
      definitions,
      values: { 'agents.type.explore': 'openai/gpt-5-mini' },
    })
    expect(
      effort === undefined ? false : isSettingVisible({ definition: effort, resolution: noBudget }),
    ).toBe(false)

    const unknown = resolutionOf({ definitions, values: {} })
    expect(
      effort === undefined ? false : isSettingVisible({ definition: effort, resolution: unknown }),
    ).toBe(true)
  })
})
