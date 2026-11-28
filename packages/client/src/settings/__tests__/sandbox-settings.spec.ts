import { describe, expect, it } from 'bun:test'

import {
  decodeSettingValue,
  EConfigLayer,
  encodeSettingValue,
  type LayeredSettingLayer,
} from '@dltech/atlas-wire/web'

import {
  DEFAULT_SANDBOX_SIZE,
  defaultDiskGbOf,
  diskSettingValuesOf,
  diskValueToSave,
  INHERIT_VALUE,
  inheritedSandboxOf,
  ownValuesOf,
  sandboxDiskOptionsOf,
  sandboxOfValues,
  sandboxSizeOptionsOf,
  savedDiskValueOf,
  savedSizeValueOf,
  SANDBOX_SETTING_KEYS,
  sizeKeyOf,
  sizeSettingValuesOf,
  sizeValueToSave,
} from '../sandbox-settings'

const layer = ({
  layer: name,
  values,
}: {
  layer: EConfigLayer
  values: Record<string, number | string>
}): LayeredSettingLayer => ({
  layer: name,
  owner: { id: null, name },
  values: Object.entries(values).map(([key, value]) => ({
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
        layer({ layer: EConfigLayer.Group, values: { 'sandbox.vcpus': 4, 'sandbox.diskGb': 80 } }),
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
    expect(inherited.diskGb).toBe(defaultDiskGbOf(undefined))
  })

  it('lists the three sandbox keys it reports', () => {
    expect(SANDBOX_SETTING_KEYS).toEqual(['sandbox.vcpus', 'sandbox.memoryGb', 'sandbox.diskGb'])
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

  it('writes the disk key, clearing it when inherited', () => {
    expect(diskSettingValuesOf(null)).toEqual({ 'sandbox.diskGb': null })
    expect(diskSettingValuesOf(60)).toEqual({ 'sandbox.diskGb': encodeSettingValue(60) })
  })
})

describe('size and disk selections', () => {
  it('marks the inherit option only when the account default is offered', () => {
    const withDefault = sandboxSizeOptionsOf({
      inherited: DEFAULT_SANDBOX_SIZE,
      withAccountDefault: true,
    })
    expect(withDefault[0]).toMatchObject({ value: INHERIT_VALUE, label: 'Default' })
    expect(withDefault[0]?.detail).not.toContain('\u00b7')
    expect(
      sandboxSizeOptionsOf({ inherited: DEFAULT_SANDBOX_SIZE, withAccountDefault: false })[0]
        ?.value,
    ).not.toBe(INHERIT_VALUE)
  })

  it('maps a saved size and a selection through the inherit value', () => {
    expect(savedSizeValueOf({ value: null, withAccountDefault: true })).toBe(INHERIT_VALUE)
    expect(savedSizeValueOf({ value: { vcpus: 4, memoryGb: 8 }, withAccountDefault: true })).toBe(
      sizeKeyOf({ vcpus: 4, memoryGb: 8 }),
    )
    expect(sizeValueToSave({ selected: INHERIT_VALUE, withAccountDefault: true })).toBeNull()
    expect(
      sizeValueToSave({ selected: sizeKeyOf({ vcpus: 4, memoryGb: 8 }), withAccountDefault: true }),
    ).toEqual({
      vcpus: 4,
      memoryGb: 8,
    })
  })

  it('maps a saved disk and a selection through the inherit value', () => {
    expect(savedDiskValueOf({ diskGb: null, withAccountDefault: true })).toBe(INHERIT_VALUE)
    expect(savedDiskValueOf({ diskGb: 60, withAccountDefault: true })).toBe('60')
    expect(diskValueToSave({ selected: INHERIT_VALUE, withAccountDefault: true })).toBeNull()
    expect(diskValueToSave({ selected: '60', withAccountDefault: true })).toBe(60)
  })

  it('offers the account default disk first', () => {
    const options = sandboxDiskOptionsOf({ inheritedDiskGb: 40, withAccountDefault: true })
    expect(options[0]).toMatchObject({ value: INHERIT_VALUE, detail: '40 GB' })
    expect(
      sandboxDiskOptionsOf({ inheritedDiskGb: 40, withAccountDefault: false })[0]?.value,
    ).not.toBe(INHERIT_VALUE)
  })

  it('decodes a stored value through the shared codec', () => {
    expect(decodeSettingValue(encodeSettingValue(80))).toBe(80)
  })
})
