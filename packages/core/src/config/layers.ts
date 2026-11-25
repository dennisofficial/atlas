export enum EConfigLayer {
  BuiltIn = 'built-in',
  Personal = 'personal',
  Group = 'group',
  Project = 'project',
  Repo = 'repo',
}

export const CONFIG_LAYER_ORDER: readonly EConfigLayer[] = [
  EConfigLayer.BuiltIn,
  EConfigLayer.Personal,
  EConfigLayer.Group,
  EConfigLayer.Project,
  EConfigLayer.Repo,
]

export type LayerItems<T> = { layer: EConfigLayer; items: readonly T[] }

export type Layered<T> = {
  item: T
  layer: EConfigLayer
  overriddenBy: EConfigLayer | null
}

const rankOf = (layer: EConfigLayer): number => CONFIG_LAYER_ORDER.indexOf(layer)

const inLayerOrder = <T>(layers: readonly LayerItems<T>[]): LayerItems<T>[] =>
  [...layers].sort((left, right) => rankOf(left.layer) - rankOf(right.layer))

export const layeredByKey = <T>(args: {
  layers: readonly LayerItems<T>[]
  keyOf: (item: T) => string
}): Layered<T>[] => {
  const ordered = inLayerOrder(args.layers)
  const highestLayerOf = new Map<string, EConfigLayer>()
  for (const layer of ordered) {
    for (const item of layer.items) highestLayerOf.set(args.keyOf(item), layer.layer)
  }
  return ordered.flatMap((layer) =>
    layer.items.map((item) => {
      const highest = highestLayerOf.get(args.keyOf(item)) ?? layer.layer
      return {
        item,
        layer: layer.layer,
        overriddenBy: rankOf(highest) > rankOf(layer.layer) ? highest : null,
      }
    }),
  )
}

export const effectiveByKey = <T>(args: {
  layers: readonly LayerItems<T>[]
  keyOf: (item: T) => string
}): T[] => {
  const winners = new Map<string, T>()
  for (const layer of inLayerOrder(args.layers)) {
    for (const item of layer.items) winners.set(args.keyOf(item), item)
  }
  return [...winners.values()]
}
