import { describe, expect, it } from 'bun:test'

import { EImageTier } from '../../images/projection'
import { ESettingId } from '../../settings/registry'
import { catalogOf, type ModelCard } from '../card'
import { EEffort } from '../effort-ladder'
import {
  EUtilityModelRole,
  UTILITY_ROLE_EFFORT,
  resolveUtilityModel,
  utilitySettingFor,
} from '../utility-roles'

const HAIKU: ModelCard = {
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  label: 'haiku-4.5',
  api: 'anthropic-messages',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
}

const GPT_CODEX_MINI: ModelCard = {
  ref: { providerId: 'openai', modelId: 'gpt-5.1-codex-mini' },
  label: 'codex-mini',
  api: 'openai-responses',
  contextWindow: 400_000,
  imageTier: EImageTier.Standard,
}

const CATALOGUE = catalogOf([HAIKU, GPT_CODEX_MINI])

const EVERY_ROLE = [
  EUtilityModelRole.Tldr,
  EUtilityModelRole.Titler,
  EUtilityModelRole.Judge,
  EUtilityModelRole.Compaction,
]

describe('utilitySettingFor', () => {
  it('serves tldr, titler and judge from the quick-call setting and compaction from its own', () => {
    expect(utilitySettingFor(EUtilityModelRole.Tldr)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Titler)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Judge)).toBe(ESettingId.QuickModel)
    expect(utilitySettingFor(EUtilityModelRole.Compaction)).toBe(ESettingId.CompactionModel)
  })
})

describe('UTILITY_ROLE_EFFORT', () => {
  it('runs the quick calls low and compaction at medium', () => {
    expect(UTILITY_ROLE_EFFORT[EUtilityModelRole.Tldr]).toBe(EEffort.Low)
    expect(UTILITY_ROLE_EFFORT[EUtilityModelRole.Titler]).toBe(EEffort.Low)
    expect(UTILITY_ROLE_EFFORT[EUtilityModelRole.Judge]).toBe(EEffort.Low)
    expect(UTILITY_ROLE_EFFORT[EUtilityModelRole.Compaction]).toBe(EEffort.Medium)
  })
})

describe('resolveUtilityModel', () => {
  it('follows the default model when no override is set, for every role', () => {
    for (const role of EVERY_ROLE) {
      expect(
        resolveUtilityModel({
          role,
          override: '',
          followDefault: GPT_CODEX_MINI.ref,
          catalogue: CATALOGUE,
        }),
      ).toEqual(GPT_CODEX_MINI.ref)
    }
  })

  it('lets one valid override serve every role', () => {
    for (const role of EVERY_ROLE) {
      expect(
        resolveUtilityModel({
          role,
          override: 'openai/gpt-5.1-codex-mini',
          followDefault: HAIKU.ref,
          catalogue: CATALOGUE,
        }),
      ).toEqual(GPT_CODEX_MINI.ref)
    }
  })

  it.each([
    ['no separator', 'gpt-5.1-codex-mini'],
    ['no provider', '/gpt-5.1-codex-mini'],
    ['no model', 'openai/'],
  ])('follows the default on a malformed override (%s)', (_shape, override) => {
    expect(
      resolveUtilityModel({
        role: EUtilityModelRole.Judge,
        override,
        followDefault: HAIKU.ref,
        catalogue: CATALOGUE,
      }),
    ).toEqual(HAIKU.ref)
  })

  it('follows the default when the override names a model the catalogue lacks', () => {
    expect(
      resolveUtilityModel({
        role: EUtilityModelRole.Titler,
        override: 'anthropic/claude-opus-4-6',
        followDefault: GPT_CODEX_MINI.ref,
        catalogue: CATALOGUE,
      }),
    ).toEqual(GPT_CODEX_MINI.ref)
  })
})
