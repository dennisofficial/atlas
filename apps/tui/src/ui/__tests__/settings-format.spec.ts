import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingKind,
  ESettingPage,
  type ChoiceDefinition,
  type RangeDefinition,
} from '@dltech/atlas-core'

import { valueLabel } from '../settings-format'

const rangeOf = (id: ESettingId): RangeDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined || found.kind !== ESettingKind.Range)
    throw new Error(`${id} is not a range`)
  return found
}

const choiceOf = (id: ESettingId): ChoiceDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined || found.kind !== ESettingKind.Choice)
    throw new Error(`${id} is not a choice`)
  return found
}

describe('valueLabel', () => {
  it('reads an unset effort as inherit rather than an empty cell', () => {
    expect(valueLabel({ definition: choiceOf(ESettingId.SubagentEffort), value: '' })).toBe(
      'inherit',
    )
    expect(valueLabel({ definition: choiceOf(ESettingId.SubagentEffort), value: 'high' })).toBe(
      'high',
    )
  })

  const UNCAPPED: RangeDefinition = {
    id: ESettingId.SandboxVcpus,
    page: ESettingPage.Cloud,
    group: 'Cloud sandboxes',
    label: 'Sandbox size',
    description: 'x',
    kind: ESettingKind.Range,
    fallback: 2,
    minimum: 0,
    maximum: 32,
    step: 2,
    unit: ' vcpu',
    zeroLabel: 'no limit',
  }

  it('reads a range at zero by its zeroLabel when it names one', () => {
    expect(valueLabel({ definition: UNCAPPED, value: 0 })).toBe('no limit')
  })

  it('reads a range above zero as the amount and unit', () => {
    expect(valueLabel({ definition: rangeOf(ESettingId.SidebarWidth), value: 56 })).toBe('56 cols')
    expect(valueLabel({ definition: rangeOf(ESettingId.ImageRows), value: 30 })).toBe('30 rows')
  })
})
