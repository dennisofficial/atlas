import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { definitionsOfPage, ESettingPage } from '../definition'
import { ESettingKind } from '../value'

describe('the PR verdict timing setting', () => {
  it('registers as an experimental choice that defaults to fail-fast', () => {
    const definition = ATLAS_SETTINGS.find((one) => one.id === ESettingId.PrVerdictTiming)
    expect(definition?.page).toBe(ESettingPage.Experimental)
    expect(definition?.kind).toBe(ESettingKind.Choice)
    expect(definition && 'fallback' in definition && definition.fallback).toBe('fail-fast')
    expect(definition && 'environmentVariable' in definition && definition.environmentVariable).toBe(
      'ATLAS_PR_VERDICT_TIMING',
    )
  })

  it('offers fail-fast and settled as the only timings', () => {
    const definition = ATLAS_SETTINGS.find((one) => one.id === ESettingId.PrVerdictTiming)
    const options = definition?.kind === ESettingKind.Choice ? definition.options : []
    expect(options.map((option) => option.value)).toEqual(['fail-fast', 'settled'])
  })

  it('joins the grilling ceremony on the experimental page', () => {
    const rows = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Experimental })
    expect(rows.map((row) => row.id)).toEqual([
      ESettingId.GrillingCeremony,
      ESettingId.PrVerdictTiming,
    ])
  })
})
