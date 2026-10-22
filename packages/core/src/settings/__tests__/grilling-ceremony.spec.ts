import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, SETTING_PAGES } from '../registry'
import { definitionsOfPage, ESettingPage } from '../definition'
import { ESettingKind } from '../value'

describe('the grilling ceremony setting', () => {
  it('holds the experimental page between appearance and cloud, ahead of code quality', () => {
    expect(SETTING_PAGES.map((page) => page.id)).toEqual([
      ESettingPage.General,
      ESettingPage.Models,
      ESettingPage.Appearance,
      ESettingPage.Experimental,
      ESettingPage.Cloud,
      ESettingPage.CodeQuality,
    ])
  })

  it('registers as an experimental toggle that defaults off', () => {
    const definition = ATLAS_SETTINGS.find((one) => one.id === ESettingId.GrillingCeremony)
    expect(definition?.page).toBe(ESettingPage.Experimental)
    expect(definition?.kind).toBe(ESettingKind.Toggle)
    expect(definition && 'fallback' in definition && definition.fallback).toBe(false)
    expect(definition && 'environmentVariable' in definition && definition.environmentVariable).toBe(
      'ATLAS_EXPERIMENTAL_GRILLING_CEREMONY',
    )
  })

  it('is the first row the experimental page carries', () => {
    const rows = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Experimental })
    expect(rows.map((row) => row.id)[0]).toBe(ESettingId.GrillingCeremony)
  })
})
