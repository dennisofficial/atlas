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

  it('keeps the master toggle id', () => {
    expect(String(ESettingId.QualityEnabled)).toBe('quality.enabled')
  })

  it('registers the master switch as a toggle that defaults on', () => {
    const definition = definitionOf(ESettingId.QualityEnabled)
    expect(definition?.page).toBe(ESettingPage.CodeQuality)
    expect(definition?.kind).toBe(ESettingKind.Toggle)
    expect(definition && 'fallback' in definition && definition.fallback).toBe(true)
    expect(definition?.group).toBe('code-quality')
  })

  it('says it runs only with a classifier set', () => {
    const definition = definitionOf(ESettingId.QualityEnabled)
    expect(definition?.label).toBe('Code quality review')
    expect(definition?.description).toContain('whenever a classifier is set')
    expect(definition?.description).toContain('off without one')
  })

  it('offers the master switch alone', () => {
    const rows = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.CodeQuality })
    expect(rows.map((row) => row.id)).toEqual([ESettingId.QualityEnabled])
  })
})
