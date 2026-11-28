import {
  ATLAS_SETTINGS,
  ESettingId,
  encodeSettingValue,
  type SettingDefinition,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  cloudValuesOf,
  decodedValuesOf,
  definitionOfSetting,
  preferencesOf,
  resolutionOf,
  seedValuesOf,
  writeOf,
} from '../settings-values'

const accent = (): SettingDefinition => {
  const found = definitionOfSetting(ESettingId.Accent)
  if (found === undefined) throw new Error('accent has no definition')
  return found
}

describe('reading what the account holds', () => {
  it('decodes a prefixed stored string and leaves a bare one alone', () => {
    const values = cloudValuesOf({
      settings: [
        { key: ESettingId.Accent, value: encodeSettingValue('moss') },
        { key: ESettingId.Logo, value: 'wordmark' },
      ],
    })

    const decoded = decodedValuesOf(values)
    expect(decoded.get(ESettingId.Accent)).toBe('moss')
    expect(decoded.get(ESettingId.Logo)).toBe('wordmark')
  })

  it('resolves the account as the only layer', () => {
    const resolution = resolutionOf({
      definitions: ATLAS_SETTINGS,
      values: new Map([[ESettingId.Accent, 'moss']]),
    })

    expect(resolution.settings.get(ESettingId.Accent)?.value).toBe('moss')
    expect(resolution.settings.get(ESettingId.Accent)?.origin).toBe('your account')
    expect(resolution.settings.get(ESettingId.Logo)?.value).toBe(
      definitionOfSetting(ESettingId.Logo)?.fallback,
    )
  })
})

describe('the drawer rows', () => {
  it('carries no row for a machine, a v1 runtime or a deleted key', () => {
    const drawn = ATLAS_SETTINGS.map((definition) => definition.id)

    for (const key of [
      'files.editor',
      'execution.location',
      'container.cpus',
      'container.memory',
      'container.idleMinutes',
      'transcript.smoothStreaming',
      'transcript.thinkingBlocks',
      'tldr.status',
      'usage.meters',
      'dev.autoRestart',
    ]) {
      expect(drawn).not.toContain(key)
    }
    expect(drawn).toContain(ESettingId.SidebarWidth)
  })
})

describe('writing a row', () => {
  it('removes the row when the value is the fallback, and encodes it otherwise', () => {
    expect(writeOf({ definition: accent(), value: 'graphite' })).toBe('remove')
    expect(writeOf({ definition: accent(), value: 'moss' })).toEqual({
      key: ESettingId.Accent,
      value: 'atlas-setting:v1:"moss"',
    })
  })
})

describe('the cached preferences', () => {
  it('keeps the promoted keys with a scalar value and ignores the rest', () => {
    const seeded = seedValuesOf({
      preferences: {
        [ESettingId.Accent]: 'moss',
        [ESettingId.SidebarWidth]: 56,
        [ESettingId.ModelId]: 'anthropic/claude-opus-5',
        [ESettingId.Logo]: { nested: true },
      },
    })

    expect(seeded.get(ESettingId.Accent)).toBe('moss')
    expect(seeded.get(ESettingId.SidebarWidth)).toBe(56)
    expect(seeded.has(ESettingId.ModelId)).toBe(false)
    expect(seeded.has(ESettingId.Logo)).toBe(false)
  })

  it('writes back only the promoted keys', () => {
    const held = new Map<string, string | number | boolean>([
      [ESettingId.Accent, 'moss'],
      [ESettingId.ModelId, 'anthropic/claude-sonnet-4-5'],
    ])

    expect(preferencesOf(held)).toEqual({ [ESettingId.Accent]: 'moss' })
  })
})
