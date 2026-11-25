import { describe, expect, it } from 'bun:test'
import { encodeSettingValue, EConfigLayer, type LayeredSettingLayer } from '@dltech/atlas-wire/web'

import {
  inheritedSandboxOf,
  ownValuesOf,
  sandboxOfValues,
  sizeSettingValuesOf,
} from '../inherited-sandbox'

const layer = (args: {
  layer: EConfigLayer
  values: Record<string, number | string>
}): LayeredSettingLayer => ({
  layer: args.layer,
  owner: { id: null, name: args.layer },
  values: Object.entries(args.values).map(([key, value]) => ({
    key,
    value: encodeSettingValue(value),
    overriddenBy: null,
  })),
})

describe('inheritedSandboxOf', () => {
  it('takes the highest layer below the own one', () => {
    const inherited = inheritedSandboxOf({
      own: EConfigLayer.Project,
      layers: [
        layer({ layer: EConfigLayer.Personal, values: { 'sandbox.vcpus': 8 } }),
        layer({
          layer: EConfigLayer.Group,
          values: { 'sandbox.vcpus': 4, 'sandbox.diskGb': 80 },
        }),
        layer({ layer: EConfigLayer.Project, values: { 'sandbox.vcpus': 2 } }),
      ],
    })
    expect(inherited.size.vcpus).toBe(4)
    expect(inherited.diskGb).toBe(80)
  })

  it('falls back to the defaults when no lower layer sets a size', () => {
    const inherited = inheritedSandboxOf({
      own: EConfigLayer.Group,
      layers: [layer({ layer: EConfigLayer.Group, values: { 'sandbox.vcpus': 2 } })],
    })
    expect(inherited.size).toEqual({ vcpus: 2, memoryGb: null })
  })
})

describe('own sandbox values', () => {
  const layers = [
    layer({ layer: EConfigLayer.Personal, values: { 'sandbox.vcpus': 8 } }),
    layer({ layer: EConfigLayer.Group, values: { 'sandbox.vcpus': 4, 'model.effort': 'high' } }),
  ]

  it('reads only the own layer', () => {
    const own = ownValuesOf({ layers, own: EConfigLayer.Group })
    expect(own.get('sandbox.vcpus')).toBe(4)
    expect(own.has('model.effort')).toBe(true)
  })

  it('reports a missing vCPU as inheriting', () => {
    expect(sandboxOfValues(ownValuesOf({ layers, own: EConfigLayer.Personal }))).toEqual({
      size: { vcpus: 8, memoryGb: null },
      diskGb: null,
    })
  })

  it('writes nulls for every size key when the size is inherited', () => {
    expect(sizeSettingValuesOf(null)).toEqual({
      'sandbox.vcpus': null,
      'sandbox.memoryGb': null,
    })
    expect(sizeSettingValuesOf({ vcpus: 2, memoryGb: 4 })).toEqual({
      'sandbox.vcpus': encodeSettingValue(2),
      'sandbox.memoryGb': encodeSettingValue(4),
    })
  })
})
