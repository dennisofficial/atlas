import { describe, expect, it } from 'bun:test'

import { definitionsOfPage, ESettingPage } from '../definition'
import { ATLAS_SETTINGS, ESettingId, SETTING_PAGES } from '../registry'
import { ESettingKind } from '../value'

const definitionOf = (id: ESettingId) => ATLAS_SETTINGS.find((one) => one.id === id)

describe('the code quality settings', () => {
  it('adds a quality page labelled quality', () => {
    expect(String(ESettingPage.CodeQuality)).toBe('quality')
    expect(SETTING_PAGES).toContainEqual({ id: ESettingPage.CodeQuality, label: 'quality' })
  })

  it('registers the master and example toggles with stable ids', () => {
    expect(String(ESettingId.QualityEnabled)).toBe('quality.enabled')
    expect(String(ESettingId.QualityRecordExamples)).toBe('quality.recordExamples')
  })

  it('registers both as toggles that default off on the quality page', () => {
    for (const id of [ESettingId.QualityEnabled, ESettingId.QualityRecordExamples]) {
      const definition = definitionOf(id)
      expect(definition?.page).toBe(ESettingPage.CodeQuality)
      expect(definition?.kind).toBe(ESettingKind.Toggle)
      expect(definition && 'fallback' in definition && definition.fallback).toBe(false)
      expect(definition?.group).toBe('code-quality')
    }
  })

  it('labels the rows as specified', () => {
    expect(definitionOf(ESettingId.QualityEnabled)?.label).toBe('Code quality review')
    expect(definitionOf(ESettingId.QualityRecordExamples)?.label).toBe('Record code-quality examples')
  })

  it('carries exactly those two rows on the page', () => {
    const rows = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.CodeQuality })
    expect(rows.map((row) => row.id)).toEqual([ESettingId.QualityEnabled, ESettingId.QualityRecordExamples])
  })
})
