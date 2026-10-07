import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '../../discovery/origin'
import { agentTypeModelDefinitions, agentTypeSettingId } from '../agent-type-rows'
import { ESettingsLayer } from '../layers'
import { definitionsOfPage, ESettingPage } from '../definition'
import { ATLAS_SETTINGS, ESettingId, SETTING_PAGES } from '../registry'
import { ESettingKind } from '../value'

const modelsRows = () => definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Models })

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

  it('holds the default pair first, then the background roles', () => {
    expect(modelsRows().map((row) => row.id)).toEqual([
      ESettingId.ModelId,
      ESettingId.ModelEffort,
      ESettingId.QuickModel,
      ESettingId.CompactionModel,
      ESettingId.SubagentModel,
    ])
  })

  it('keeps every model row on the models page and off general', () => {
    const general = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.General })

    expect(general.some((row) => row.kind === ESettingKind.Model)).toBe(false)
    expect(modelsRows().every((row) => row.kind === ESettingKind.Model || row.id === ESettingId.ModelEffort)).toBe(true)
  })

  it('gives every model row an environment variable override', () => {
    for (const row of modelsRows()) {
      expect(row.environmentVariable).toBeDefined()
    }
  })
})

describe('agentTypeModelDefinitions', () => {
  it('builds one model row per built-in type on the models page', () => {
    const definitions = agentTypeModelDefinitions({
      types: ['explore', 'builder'].map((name) => ({ name, origin: EDefinitionOrigin.BuiltIn })),
    })

    expect(definitions.map((definition) => definition.id)).toEqual([
      'agents.type.explore',
      'agents.type.builder',
    ])
    for (const definition of definitions) {
      expect(definition.kind).toBe(ESettingKind.Model)
      expect(definition.page).toBe(ESettingPage.Models)
      expect(definition.group).toBe('Built-in sub-agents')
      expect(definition.fallback).toBe('')
    }
  })

  it('places teammates with the main model and inherits the main agent', () => {
    const [definition] = agentTypeModelDefinitions({ types: [{ name: 'teammate', origin: EDefinitionOrigin.BuiltIn }] })

    expect(definition?.id).toBe('agents.type.teammate')
    expect(definition?.page).toBe(ESettingPage.Models)
    expect(definition?.group).toBe('Model')
    expect(definition?.label).toBe('Teammates')
    expect(definition?.unsetLabel).toBe('follow main agent')
    expect(definition?.description).toContain("main agent's current model and effort")
  })

  it('retains provenance and scopes repository choices to project settings', () => {
    const types = [
      { name: 'reviewer', origin: EDefinitionOrigin.Project, definedIn: '/repo/.atlas/agents/reviewer.md' },
      { name: 'auditor', origin: EDefinitionOrigin.User, definedIn: '/home/.atlas/agents/auditor.md' },
      { name: 'builder', origin: EDefinitionOrigin.BuiltIn },
    ]
    const definitions = agentTypeModelDefinitions({ types })

    expect(definitions.map((definition) => definition.group)).toEqual([
      'Repository-defined sub-agents',
      'Global user-defined sub-agents',
      'Built-in sub-agents',
    ])
    expect(definitions.map((definition) => definition.agentType)).toEqual(types)
    expect(definitions.map((definition) => definition.writeLayer)).toEqual([
      ESettingsLayer.Project,
      ESettingsLayer.User,
      ESettingsLayer.User,
    ])
  })

  it('retains the overriding origin for display-only definitions', () => {
    const [definition] = agentTypeModelDefinitions({
      types: [{
        name: 'reviewer',
        origin: EDefinitionOrigin.BuiltIn,
        overriddenBy: EDefinitionOrigin.Project,
      }],
    })

    expect(definition?.agentType?.overriddenBy).toBe(EDefinitionOrigin.Project)
    expect(definition?.id).toBe('agents.type.reviewer')
  })

  it('derives stable ids from the type name', () => {
    expect(agentTypeSettingId('general-purpose')).toBe('agents.type.general-purpose')
  })
})
