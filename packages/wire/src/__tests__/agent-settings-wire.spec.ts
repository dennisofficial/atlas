import { describe, expect, it } from 'bun:test'

import {
  CLOUD_SETTING_REGISTRY,
  EClassifierModeWire,
  EDecisionsProviderWire,
  encodeSettingValue,
  ESettingConsumer,
  EWebSearchBackendWire,
  PROJECT_SETTING_REGISTRY,
  validateCloudSetting,
} from '../web'

const POD_DELIVERED_KEYS = [
  'decisions.provider',
  'decisions.url',
  'decisions.model',
  'classifier.mode',
  'web.searchBackend',
]

const CORE_CLASSIFIER_MODES = ['off', 'shadow', 'nudge']
const CORE_DECISIONS_PROVIDERS = ['typesafe', 'vercel', 'openai', 'custom']
const CORE_SEARCH_BACKENDS = ['duckduckgo', 'jina', 'tavily', 'exa', 'brave', 'searxng']

const verdictOf = (args: { key: string; value: unknown }) =>
  validateCloudSetting({ key: args.key, stored: encodeSettingValue(args.value) })

describe('pod-delivered agent settings', () => {
  it('registers the five pod-delivered settings as harness-consumed', () => {
    for (const key of POD_DELIVERED_KEYS) {
      expect(CLOUD_SETTING_REGISTRY.get(key)?.consumer).toBe(ESettingConsumer.Harness)
      expect(PROJECT_SETTING_REGISTRY.has(key)).toBe(true)
    }
  })

  it('rejects a decisions.url that is not an absolute http(s) URL', () => {
    expect(verdictOf({ key: 'decisions.url', value: 'jev.internal' }).ok).toBe(false)
    expect(verdictOf({ key: 'decisions.url', value: 'https://jev.internal' }).ok).toBe(true)
    expect(verdictOf({ key: 'decisions.url', value: '' }).ok).toBe(true)
  })

  it('rejects out-of-enum classifier.mode and web.searchBackend', () => {
    expect(verdictOf({ key: 'classifier.mode', value: 'interrupt' }).ok).toBe(false)
    expect(verdictOf({ key: 'web.searchBackend', value: 'google' }).ok).toBe(false)
    expect(verdictOf({ key: 'classifier.mode', value: 'nudge' }).ok).toBe(true)
    expect(verdictOf({ key: 'web.searchBackend', value: 'searxng' }).ok).toBe(true)
  })

  it('matches the core registry values byte-for-byte', () => {
    const sorted = (values: readonly string[]): string[] => [...values].sort()
    expect(sorted(Object.values(EClassifierModeWire))).toEqual(sorted(CORE_CLASSIFIER_MODES))
    expect(sorted(Object.values(EDecisionsProviderWire))).toEqual(sorted(CORE_DECISIONS_PROVIDERS))
    expect(sorted(Object.values(EWebSearchBackendWire))).toEqual(sorted(CORE_SEARCH_BACKENDS))
  })
})
