import { describe, expect, it } from 'vitest'

import { definitionsOfPage, ESettingPage, type ChoiceDefinition } from '../definition'
import { ESettingsLayer } from '../layers'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { choiceValueOf, resolveSettings } from '../resolve'
import { ESettingKind } from '../value'

const definition = (): ChoiceDefinition => {
  const found = ATLAS_SETTINGS.find((candidate) => candidate.id === ESettingId.Logo)
  if (found === undefined) throw new Error('the logo setting is not registered')
  if (found.kind !== ESettingKind.Choice) throw new Error('the logo setting is not a choice')
  return found
}

const resolutionOf = (values: Record<string, unknown>) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'settings.json', values }],
  })

describe('the logo setting', () => {
  it('lives on the appearance page, after the composer edge', () => {
    const ids = definitionsOfPage({
      definitions: ATLAS_SETTINGS,
      page: ESettingPage.Appearance,
    }).map((row) => row.id)

    expect(ids).toContain(ESettingId.Logo)
    expect(ids.indexOf(ESettingId.Logo)).toBeGreaterThan(ids.indexOf(ESettingId.ComposerEdge))
  })

  it('offers the mark alone, shipped, and the wordmark lockup', () => {
    expect(definition().fallback).toBe('mark')
    expect(definition().environmentVariable).toBe('ATLAS_LOGO')
    expect(definition().options.map((option) => option.value)).toEqual(['mark', 'wordmark'])
    expect(definition().options.find((option) => option.detail === 'shipped')?.value).toBe(
      'mark',
    )
  })

  it('resolves to the mark until the wordmark is chosen', () => {
    const read = (values: Record<string, unknown>) =>
      choiceValueOf({
        resolution: resolutionOf(values),
        id: ESettingId.Logo,
        fallback: 'mark',
      })

    expect(read({})).toBe('mark')
    expect(read({ [ESettingId.Logo]: 'wordmark' })).toBe('wordmark')
  })
})
