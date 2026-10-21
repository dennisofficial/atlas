import { describe, expect, it } from 'vitest'

import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { ESettingPage, definitionsOfPage } from '../definition'
import { ESettingsLayer } from '../layers'
import { choiceValueOf, resolveSettings } from '../resolve'
import { ESettingKind } from '../value'

const shapeOf = (file: Record<string, unknown>): string =>
  choiceValueOf({
    resolution: resolveSettings({
      definitions: ATLAS_SETTINGS,
      layers: [{ layer: ESettingsLayer.User, origin: 'settings.json', values: file }],
    }),
    id: ESettingId.PlacementChooserShape,
    fallback: 'unreachable',
  })

describe('the placement chooser shape setting', () => {
  it('registers as an experimental choice', () => {
    const definition = ATLAS_SETTINGS.find((one) => one.id === ESettingId.PlacementChooserShape)

    expect(definition?.kind).toBe(ESettingKind.Choice)
    expect(definition?.page).toBe(ESettingPage.Experimental)
  })

  it('appears among the rows of the experimental page', () => {
    const rows = definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Experimental })
    expect(rows.map((row) => row.id)).toContain(ESettingId.PlacementChooserShape)
  })

  it('reads as the shipped chip until the operator opts into the hero', () => {
    expect(shapeOf({})).toBe('chip')
  })

  it('reads hero from the file, and coerces anything else back to chip', () => {
    expect(shapeOf({ [ESettingId.PlacementChooserShape]: 'hero' })).toBe('hero')
    expect(shapeOf({ [ESettingId.PlacementChooserShape]: 'banner' })).toBe('chip')
  })
})
