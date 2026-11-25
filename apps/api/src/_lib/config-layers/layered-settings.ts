import { EConfigLayer, type LayeredSettingLayer, type LayeredSettings } from '@dltech/atlas-wire'
import { overrideIndexOf, overrideOf } from './override-index'

export type SettingValue = { key: string; value: string }

export type SettingsLayer = {
  layer: EConfigLayer
  owner: LayeredSettingLayer['owner']
  values: readonly SettingValue[]
}

export const layeredSettingsOf = (layers: readonly SettingsLayer[]): LayeredSettings => {
  const index = overrideIndexOf({
    layers: layers.map((entry) => ({ layer: entry.layer, items: entry.values })),
    keyOf: (value) => value.key,
  })
  return {
    layers: layers.map((entry) => ({
      layer: entry.layer,
      owner: entry.owner,
      values: entry.values.map((value) => ({
        key: value.key,
        value: value.value,
        overriddenBy: overrideOf({ index, layer: entry.layer, key: value.key }),
      })),
    })),
  }
}
