import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ESettingId } from '../../registry'
import { ESettingKind } from '../../value'
import { encodeSettingValue } from '../setting-codec'
import {
  CLIENT_SETTING_ENTRIES,
  CLIENT_SETTING_IDS,
  definitionOf,
  schemaForDefinition,
} from '../client-settings'
import { CLOUD_SETTING_REGISTRY, validateCloudSetting } from '../settings-registry'

const encoded = (value: unknown): string => encodeSettingValue(value)

describe('CLIENT_SETTING_IDS', () => {
  it('names the seven look keys the new TUI reads, each with a definition the registry keeps', () => {
    expect(CLIENT_SETTING_IDS).toHaveLength(7)
    for (const id of CLIENT_SETTING_IDS) {
      const definition = definitionOf(id)
      expect(definition.id).toBe(id)
      expect(CLOUD_SETTING_REGISTRY.get(id)?.fallback).toEqual(definition.fallback)
    }
  })

  it('derives each schema from the definition it is given, not from a copy', () => {
    for (const [key, entry] of CLIENT_SETTING_ENTRIES) {
      const definition = ATLAS_SETTINGS.find((held) => held.id === key)
      if (definition === undefined) throw new Error(`no definition for ${key}`)

      expect(entry.schema.safeParse(entry.fallback).success).toBe(true)

      if (definition.kind === ESettingKind.Choice)
        expect(entry.schema.safeParse('not-an-offered-option').success).toBe(false)
      if (definition.kind === ESettingKind.Range)
        expect(entry.schema.safeParse(definition.maximum + definition.step).success).toBe(false)
      if (definition.kind === ESettingKind.Toggle)
        expect(entry.schema.safeParse('on').success).toBe(false)
    }
  })

  it('throws on a definition it cannot map', () => {
    const held = definitionOf(ESettingId.Accent)
    if (held.kind !== 'choice') throw new Error('accent is no longer a choice')
    expect(() => schemaForDefinition({ ...held, kind: 'unknown' as never })).toThrow()
  })
})

describe('the drawer keys are settings the API validates', () => {
  it('refuses a range value outside the definition its drawer row shows', () => {
    expect(validateCloudSetting({ key: 'sidebar.width', stored: encoded(900) })).toEqual({
      ok: false,
      reason: expect.stringContaining('sidebar.width'),
    })
    expect(validateCloudSetting({ key: 'sidebar.width', stored: encoded(42) })).toEqual({
      ok: true,
    })
  })

  it('refuses a choice the drawer never offers', () => {
    expect(validateCloudSetting({ key: 'appearance.accent', stored: encoded('neon') }).ok).toBe(
      false,
    )
    expect(validateCloudSetting({ key: 'appearance.accent', stored: encoded('moss') }).ok).toBe(
      true,
    )
  })

  it('keeps the dropped rows out of the account registry', () => {
    expect(CLOUD_SETTING_REGISTRY.has(ESettingId.Editor)).toBe(false)
    expect(CLOUD_SETTING_REGISTRY.has(ESettingId.ContainerCpus)).toBe(false)
    expect(CLOUD_SETTING_REGISTRY.has('transcript.smoothStreaming')).toBe(false)
    expect(CLOUD_SETTING_REGISTRY.has('tldr.status')).toBe(false)
    expect(CLOUD_SETTING_REGISTRY.has(ESettingId.Accent)).toBe(true)
  })
})
