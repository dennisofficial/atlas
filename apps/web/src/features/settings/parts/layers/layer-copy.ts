import { CONFIG_LAYER_ORDER, EConfigLayer } from '@dltech/atlas-core'
import type { ConfigLayerOwner } from '@dltech/atlas-wire/web'

export type LayerRef = { layer: EConfigLayer; owner: ConfigLayerOwner }

const NOUN_OF_LAYER: Readonly<Record<EConfigLayer, string>> = {
  [EConfigLayer.BuiltIn]: 'built-in',
  [EConfigLayer.Personal]: 'personal',
  [EConfigLayer.Group]: 'group',
  [EConfigLayer.Project]: 'project',
  [EConfigLayer.Repo]: 'repo',
}

export const inheritedTitleOf = ({ layer, owner }: LayerRef): string => {
  if (layer === EConfigLayer.BuiltIn) return 'Built-in'
  if (layer === EConfigLayer.Personal) return 'From personal settings'
  if (layer === EConfigLayer.Group) return `From ${owner.name} group`
  if (layer === EConfigLayer.Project) return `From ${owner.name}`
  return 'From repo'
}

export const originNounOf = ({ layer }: LayerRef): string => NOUN_OF_LAYER[layer]

export const overriddenLabelOf = (shadow: EConfigLayer): string =>
  `Overridden by ${NOUN_OF_LAYER[shadow]}`

export const overridesLabelOf = (shadow: EConfigLayer): string =>
  `Overrides ${NOUN_OF_LAYER[shadow]}`

export const layersBelowOf = (current: EConfigLayer): readonly EConfigLayer[] =>
  CONFIG_LAYER_ORDER.slice(0, CONFIG_LAYER_ORDER.indexOf(current))

export const shadowedBelowOf = <T>(args: {
  layers: readonly { layer: EConfigLayer; items: readonly T[] }[]
  current: EConfigLayer
  keyOf: (item: T) => string
}): ReadonlyMap<string, EConfigLayer> => {
  const below = new Set(layersBelowOf(args.current))
  const shadowed = new Map<string, EConfigLayer>()
  for (const entry of args.layers) {
    if (!below.has(entry.layer)) continue
    for (const item of entry.items) shadowed.set(args.keyOf(item), entry.layer)
  }
  return shadowed
}

export const inheritedIdsOf = <T>(args: {
  layers: readonly { items: readonly T[] }[]
  keyOf: (item: T) => string
}): ReadonlySet<string> =>
  new Set(args.layers.flatMap((entry) => entry.items.map((item) => args.keyOf(item))))
