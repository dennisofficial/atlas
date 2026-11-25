import { layeredByKey, type EConfigLayer, type LayerItems } from '@dltech/atlas-core'
import type { ConfigLayerOwner } from '@dltech/atlas-wire'

export type LayeredItem<T> = T & { overriddenBy: EConfigLayer | null }

export type LayeredOutput<T> = {
  layer: EConfigLayer
  owner: ConfigLayerOwner
  items: LayeredItem<T>[]
}

export const layeredItemsOf = <T extends { name: string }>(args: {
  layers: readonly LayerItems<T>[]
  ownerOf: (layer: EConfigLayer) => ConfigLayerOwner
}): LayeredOutput<T>[] => {
  const resolved = layeredByKey({
    layers: args.layers,
    keyOf: (item) => item.name.trim().toLowerCase(),
  })
  const layers: LayeredOutput<T>[] = []
  let current: LayeredOutput<T> | undefined
  for (const row of resolved) {
    if (current === undefined || current.layer !== row.layer) {
      current = { layer: row.layer, owner: args.ownerOf(row.layer), items: [] }
      layers.push(current)
    }
    current.items.push({ ...row.item, overriddenBy: row.overriddenBy })
  }
  return layers
}
