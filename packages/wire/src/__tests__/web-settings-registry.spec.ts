import { describe, expect, it } from 'bun:test'

import {
  CLOUD_SETTING_REGISTRY,
  decodeSettingValue,
  encodeSettingValue,
  ESettingConsumer,
  parsePinnedModels,
  validateCloudSetting,
} from '../web'

const stored = (value: unknown): string => encodeSettingValue(value)

describe('setting codec', () => {
  it('round-trips scalars', () => {
    for (const value of ['medium', 4, true, false, '']) {
      expect(decodeSettingValue(encodeSettingValue(value))).toBe(value)
    }
  })

  it('returns an unprefixed or non-scalar payload verbatim', () => {
    expect(decodeSettingValue('plain')).toBe('plain')
    expect(decodeSettingValue('atlas-setting:v1:{"a":1}')).toBe('atlas-setting:v1:{"a":1}')
    expect(decodeSettingValue('atlas-setting:v1:{oops')).toBe('atlas-setting:v1:{oops')
  })
})

describe('cloud setting registry', () => {
  it('passes a key it does not know', () => {
    expect(validateCloudSetting({ key: 'legacy.thing', stored: 'whatever' })).toEqual({ ok: true })
  })

  it('accepts and rejects harness values by kind', () => {
    const cases: Array<[string, unknown, boolean]> = [
      ['model.id', 'anthropic/claude-opus', true],
      ['model.id', '', true],
      ['model.id', 'claude-opus', false],
      ['model.id', 'anthropic/', false],
      ['model.id', '/claude-opus', false],
      ['model.id', 3, false],
      ['agents.subagentModel', 'openai/gpt-5', true],
      ['agents.subagentModel', '', true],
      ['agents.subagentModel', 'gpt-5', false],
      ['model.effort', 'xhigh', true],
      ['model.effort', 'extreme', false],
      ['sandbox.vcpus', 4, true],
      ['sandbox.vcpus', 3, false],
      ['sandbox.vcpus', 10, false],
      ['sandbox.vcpus', 0, false],
      ['experimental.grillingCeremony', true, true],
      ['experimental.grillingCeremony', 'yes', false],
      ['experimental.placementChooserShape', 'hero', true],
      ['experimental.placementChooserShape', 'wide', false],
      ['github.prEvents.verdictTiming', 'settled', true],
      ['github.prEvents.verdictTiming', 'later', false],
    ]
    for (const [key, value, ok] of cases) {
      expect(validateCloudSetting({ key, stored: stored(value) }).ok).toBe(ok)
    }
  })

  it('accepts and rejects web-only values by kind', () => {
    const cases: Array<[string, unknown, boolean]> = [
      ['web.models.preset', 'custom', true],
      ['web.models.preset', 'turbo', false],
      ['web.appearance.codeFontSize', 14, true],
      ['web.appearance.codeFontSize', 15, false],
      ['web.appearance.theme', 'system', true],
      ['web.notifications.quietFrom', '22:00', true],
      ['web.notifications.quietFrom', '22:30', false],
      ['web.notifications.quietTo', '24:00', false],
      ['web.notifications.event.finished.push', false, true],
      ['web.notifications.event.finished.push', 'no', false],
    ]
    for (const [key, value, ok] of cases) {
      expect(validateCloudSetting({ key, stored: stored(value) }).ok).toBe(ok)
    }
  })

  it('accepts pinned models only as a json array of strings', () => {
    const cases: Array<[string, boolean]> = [
      ['[]', true],
      ['["anthropic/claude-opus-4-7","openai/gpt-5"]', true],
      ['[1]', false],
      ['{"a":1}', false],
      ['not json', false],
    ]
    for (const [value, ok] of cases) {
      expect(validateCloudSetting({ key: 'web.models.pinned', stored: stored(value) }).ok).toBe(ok)
    }
  })

  it('parses pinned models and falls back to an empty list', () => {
    expect(parsePinnedModels('["a/b","c/d"]')).toEqual(['a/b', 'c/d'])
    expect(parsePinnedModels(undefined)).toEqual([])
    expect(parsePinnedModels('')).toEqual([])
    expect(parsePinnedModels('nope')).toEqual([])
    expect(parsePinnedModels('[1,"a/b"]')).toEqual([])
    expect(parsePinnedModels(7)).toEqual([])
  })

  it('has 18 notification event keys and tags consumers', () => {
    const eventKeys = [...CLOUD_SETTING_REGISTRY.keys()].filter((key) =>
      key.startsWith('web.notifications.event.'),
    )
    expect(eventKeys).toHaveLength(18)
    expect(CLOUD_SETTING_REGISTRY.get('sandbox.vcpus')?.consumer).toBe(ESettingConsumer.Harness)
    expect(CLOUD_SETTING_REGISTRY.get('github.prEvents.verdictTiming')?.consumer).toBe(
      ESettingConsumer.Api,
    )
    expect(CLOUD_SETTING_REGISTRY.get('web.appearance.theme')?.consumer).toBe(ESettingConsumer.None)
  })

  it('every fallback satisfies its own schema', () => {
    for (const entry of CLOUD_SETTING_REGISTRY.values()) {
      expect(entry.schema.safeParse(entry.fallback).success).toBe(true)
    }
  })
})
