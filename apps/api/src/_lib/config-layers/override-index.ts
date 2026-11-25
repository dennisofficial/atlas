import { layeredByKey, type EConfigLayer, type LayerItems } from '@dltech/atlas-core'

export type LayerOverrideIndex = Map<string, EConfigLayer | null>

const indexKeyOf = (args: { layer: EConfigLayer; key: string }): string =>
  `${args.layer}:${args.key}`

export const overrideIndexOf = <T>(args: {
  layers: readonly LayerItems<T>[]
  keyOf: (item: T) => string
}): LayerOverrideIndex =>
  new Map(
    layeredByKey(args).map((entry) => [
      indexKeyOf({ layer: entry.layer, key: args.keyOf(entry.item) }),
      entry.overriddenBy,
    ]),
  )

export const overrideOf = (args: {
  index: LayerOverrideIndex
  layer: EConfigLayer
  key: string
}): EConfigLayer | null => args.index.get(indexKeyOf({ layer: args.layer, key: args.key })) ?? null
