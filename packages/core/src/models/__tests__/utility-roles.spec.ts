import { describe, expect, it } from 'bun:test'

import { ESettingId } from '../../settings/registry'
import { EUtilityModelRole, UTILITY_ROLE_LABEL, utilitySettingFor } from '../utility-roles'

describe('utilitySettingFor', () => {
  it('serves tldr, titler and judge from the quick-call setting and compaction from its own', () => {
    expect(utilitySettingFor(EUtilityModelRole.Tldr)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Titler)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Judge)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Compaction)).toBe(ESettingId.CompactionModel)
  })
})

describe('UTILITY_ROLE_LABEL', () => {
  it('names every role', () => {
    for (const role of Object.values(EUtilityModelRole))
      expect(UTILITY_ROLE_LABEL[role].length).toBeGreaterThan(0)
  })
})
