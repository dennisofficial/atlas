import { describe, expect, it } from 'bun:test'

import {
  CONFIG_LAYER_ORDER,
  EConfigLayer,
  effectiveByKey,
  layeredByKey,
  type LayerItems,
} from '../layers'

type Entry = { name: string; value: string }

const entry = (name: string, value = name): Entry => ({ name, value })
const keyOf = (item: Entry): string => item.name

const layersOf = (...layers: Array<{ layer: EConfigLayer; items: Entry[] }>): LayerItems<Entry>[] =>
  layers

describe('CONFIG_LAYER_ORDER', () => {
  it('runs lowest to highest from built-in to repo', () => {
    expect(CONFIG_LAYER_ORDER).toEqual([
      EConfigLayer.BuiltIn,
      EConfigLayer.Personal,
      EConfigLayer.Group,
      EConfigLayer.Project,
      EConfigLayer.Repo,
    ])
  })
})

describe('layeredByKey', () => {
  it('lists every item in layer order and names the layer that overrides it', () => {
    const layered = layeredByKey({
      layers: layersOf(
        { layer: EConfigLayer.Project, items: [entry('model', 'opus')] },
        { layer: EConfigLayer.Personal, items: [entry('model', 'sonnet'), entry('effort')] },
        { layer: EConfigLayer.Group, items: [entry('model', 'haiku')] },
      ),
      keyOf,
    })

    expect(layered).toEqual([
      {
        item: entry('model', 'sonnet'),
        layer: EConfigLayer.Personal,
        overriddenBy: EConfigLayer.Project,
      },
      { item: entry('effort'), layer: EConfigLayer.Personal, overriddenBy: null },
      {
        item: entry('model', 'haiku'),
        layer: EConfigLayer.Group,
        overriddenBy: EConfigLayer.Project,
      },
      { item: entry('model', 'opus'), layer: EConfigLayer.Project, overriddenBy: null },
    ])
  })

  it('keeps input order inside a layer and only counts a layer above as an override', () => {
    const layered = layeredByKey({
      layers: layersOf({
        layer: EConfigLayer.Group,
        items: [entry('a', 'first'), entry('a', 'second'), entry('b')],
      }),
      keyOf,
    })

    expect(layered.map((held) => [held.item.value, held.overriddenBy])).toEqual([
      ['first', null],
      ['second', null],
      ['b', null],
    ])
  })

  it('treats an empty layer list as nothing to layer', () => {
    expect(layeredByKey({ layers: [], keyOf })).toEqual([])
  })
})

describe('effectiveByKey', () => {
  it('keeps the highest layer item for each key', () => {
    const effective = effectiveByKey({
      layers: layersOf(
        {
          layer: EConfigLayer.BuiltIn,
          items: [entry('model', 'built-in'), entry('effort', 'low')],
        },
        { layer: EConfigLayer.Personal, items: [entry('model', 'sonnet')] },
        { layer: EConfigLayer.Group, items: [entry('model', 'haiku')] },
        { layer: EConfigLayer.Project, items: [entry('speech', 'on')] },
      ),
      keyOf,
    })

    expect(effective).toEqual([
      entry('model', 'haiku'),
      entry('effort', 'low'),
      entry('speech', 'on'),
    ])
  })

  it('lets the last item of the highest layer win a repeated key', () => {
    const effective = effectiveByKey({
      layers: layersOf({
        layer: EConfigLayer.Personal,
        items: [entry('a', 'first'), entry('a', 'last')],
      }),
      keyOf,
    })

    expect(effective).toEqual([entry('a', 'last')])
  })
})
