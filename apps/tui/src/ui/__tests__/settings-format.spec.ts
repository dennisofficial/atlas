import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId, ESettingKind, type RangeDefinition } from '@dltech/atlas-core'

import { valueLabel } from '../settings-format'

const rangeOf = (id: ESettingId): RangeDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined || found.kind !== ESettingKind.Range) throw new Error(`${id} is not a range`)
  return found
}

describe('valueLabel', () => {
  it('reads a range at zero by its zeroLabel when it names one', () => {
    expect(valueLabel({ definition: rangeOf(ESettingId.ContainerCpus), value: 0 })).toBe('no limit')
    expect(valueLabel({ definition: rangeOf(ESettingId.ContainerMemory), value: 0 })).toBe(
      'no limit',
    )
  })

  it('reads a range above zero as the amount and unit', () => {
    expect(valueLabel({ definition: rangeOf(ESettingId.ContainerCpus), value: 4 })).toBe('4 cpus')
    expect(valueLabel({ definition: rangeOf(ESettingId.ContainerMemory), value: 8 })).toBe('8 GB')
  })
})
