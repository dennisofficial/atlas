import { describe, expect, it } from 'bun:test'

import { definitionsOfPage, ESettingPage } from '../definition'
import { ATLAS_SETTINGS, ESettingId, SETTING_PAGES } from '../registry'
import { ESettingKind } from '../value'

const experimentalRows = () =>
  definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Experimental })

describe('the experimental settings page', () => {
  it('sits between appearance and cloud', () => {
    expect(SETTING_PAGES.map((page) => page.id)).toEqual([
      ESettingPage.General,
      ESettingPage.Models,
      ESettingPage.Appearance,
      ESettingPage.Experimental,
      ESettingPage.Cloud,
    ])
  })

  it('carries the multimodal input-cap workaround as an opt-in toggle', () => {
    const held = experimentalRows().find((row) => row.id === ESettingId.MultimodalCapWorkaround)

    expect(held).toBeDefined()
    expect(held?.group).toBe('Reliability')
    expect(held?.kind).toBe(ESettingKind.Toggle)
    if (held?.kind === ESettingKind.Toggle) expect(held.fallback).toBe(false)
    expect(held?.environmentVariable).toBe('ATLAS_EXPERIMENTAL_MULTIMODAL_CAP_WORKAROUND')
  })
})
