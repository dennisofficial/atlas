import { describe, expect, it } from 'bun:test'

import { agentTypeModelDefinitions, agentTypeSettingId } from '../agent-type-rows'
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
      ESettingPage.Account,
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
  it('builds one model row per type, grouped under sub-agent types on the models page', () => {
    const definitions = agentTypeModelDefinitions({ typeNames: ['explore', 'builder'] })

    expect(definitions.map((definition) => definition.id)).toEqual([
      'agents.type.explore',
      'agents.type.builder',
    ])
    for (const definition of definitions) {
      expect(definition.kind).toBe(ESettingKind.Model)
      expect(definition.page).toBe(ESettingPage.Models)
      expect(definition.group).toBe('Sub-agent types')
      expect(definition.fallback).toBe('')
    }
  })

  it('derives stable ids from the type name', () => {
    expect(agentTypeSettingId('general-purpose')).toBe('agents.type.general-purpose')
  })
})
