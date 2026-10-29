import { describe, expect, it } from 'bun:test'

import { ESettingPage, ESettingStorage, isLocalSetting } from '../definition'
import { ATLAS_SETTINGS, ESettingId } from '../registry'

const localIds = (): string[] =>
  ATLAS_SETTINGS.filter(isLocalSetting).map((definition) => definition.id)

describe('setting storage', () => {
  it('marks every appearance setting local', () => {
    const appearance = ATLAS_SETTINGS.filter((d) => d.page === ESettingPage.Appearance)
    expect(appearance.length).toBeGreaterThan(0)
    for (const definition of appearance) expect(definition.storage).toBe(ESettingStorage.Local)
  })

  it('keeps pods, placement state and chooser shape local', () => {
    expect(localIds()).toEqual(
      expect.arrayContaining([
        ESettingId.ExperimentalPods,
        ESettingId.LastBornPlacement,
        ESettingId.PlacementChooserShape,
      ]),
    )
  })

  it('treats grilling, verdict timing and favourites as cloud settings', () => {
    for (const id of [
      ESettingId.GrillingCeremony,
      ESettingId.PrVerdictTiming,
      ESettingId.ModelFavourites,
    ]) {
      expect(localIds()).not.toContain(id)
    }
  })
})
