import { ATLAS_SETTINGS, ESettingId, ESettingsLayer, textValueOf } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { MemorySecretsStore } from '../../secrets/memory-store'
import { MemorySettingsStore } from '../memory-store'
import { migrateDecisionsSettings } from '../migrate-decisions'
import { createSettingsService } from '../service'

const rig = (args: { values?: Record<string, string>; secrets?: Record<string, string> }) => {
  const user = new MemorySettingsStore({ document: { values: args.values ?? {} } })
  const settings = createSettingsService({ definitions: ATLAS_SETTINGS, user })
  const secrets = new MemorySecretsStore({ secrets: args.secrets ?? {} })
  return { user, settings, secrets, run: () => migrateDecisionsSettings({ settings, secrets }) }
}

const providerOf = (settings: ReturnType<typeof rig>['settings']): string =>
  textValueOf({ resolution: settings.snapshot().resolution, id: ESettingId.DecisionsProvider })

describe('migrateDecisionsSettings', () => {
  it('does nothing when nothing was set', () => {
    const held = rig({})
    held.run()

    expect(held.user.document().values).toEqual({})
    expect(providerOf(held.settings)).toBe('typesafe')
  })

  it('leaves an explicitly chosen provider and its tokens alone', () => {
    const held = rig({
      values: { [ESettingId.DecisionsProvider]: 'openai', [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai' },
      secrets: { 'decisions.token': 'flat' },
    })
    held.run()

    expect(providerOf(held.settings)).toBe('openai')
    expect(held.secrets.read('decisions.token')).toBe('flat')
    expect(held.secrets.read('decisions.token.openai')).toBeUndefined()
  })

  it('maps a preset url to its provider and moves the flat token under it', () => {
    const held = rig({
      values: { [ESettingId.DecisionsUrl]: 'https://ai-gateway.vercel.sh/typesafe/' },
      secrets: { 'decisions.token': 'sk-flat' },
    })
    held.run()

    const resolution = held.settings.snapshot().resolution
    expect(resolution.settings.get(ESettingId.DecisionsProvider)?.layer).toBe(ESettingsLayer.User)
    expect(providerOf(held.settings)).toBe('vercel')
    expect(held.secrets.read('decisions.token.vercel')).toBe('sk-flat')
    expect(held.secrets.read('decisions.token')).toBeUndefined()
  })

  it('treats a preset url carrying the systemone route as that preset', () => {
    const held = rig({ values: { [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai/v1/systemone' } })
    held.run()

    expect(providerOf(held.settings)).toBe('typesafe')
  })

  it('maps an unknown url to custom, keeps the url, and moves the token under custom', () => {
    const held = rig({
      values: { [ESettingId.DecisionsUrl]: 'http://laya.local:8080' },
      secrets: { 'decisions.token': 'sk-flat' },
    })
    held.run()

    expect(providerOf(held.settings)).toBe('custom')
    expect(textValueOf({ resolution: held.settings.snapshot().resolution, id: ESettingId.DecisionsUrl })).toBe(
      'http://laya.local:8080',
    )
    expect(held.secrets.read('decisions.token.custom')).toBe('sk-flat')
    expect(held.secrets.read('decisions.token')).toBeUndefined()
  })

  it('sets the provider without inventing a token when none was stored', () => {
    const held = rig({ values: { [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai' } })
    held.run()

    expect(providerOf(held.settings)).toBe('typesafe')
    expect(held.secrets.read('decisions.token.typesafe')).toBeUndefined()
  })

  it('does not clobber a token already stored under the target provider', () => {
    const held = rig({
      values: { [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai' },
      secrets: { 'decisions.token': 'old', 'decisions.token.typesafe': 'new' },
    })
    held.run()

    expect(held.secrets.read('decisions.token.typesafe')).toBe('new')
    expect(held.secrets.read('decisions.token')).toBeUndefined()
  })

  it('moves a flat token when the provider was set but the token was not migrated', () => {
    const held = rig({
      values: { [ESettingId.DecisionsProvider]: 'vercel' },
      secrets: { 'decisions.token': 'sk-flat' },
    })
    held.run()

    expect(held.secrets.read('decisions.token.vercel')).toBe('sk-flat')
    expect(held.secrets.read('decisions.token')).toBeUndefined()
  })

  it('is a no-op the second time when nothing is left to migrate', () => {
    const held = rig({
      values: { [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai' },
      secrets: { 'decisions.token': 'sk-flat' },
    })
    held.run()
    const settingsAfterFirst = JSON.stringify(held.user.document())
    held.run()

    expect(JSON.stringify(held.user.document())).toBe(settingsAfterFirst)
    expect(held.secrets.read('decisions.token.typesafe')).toBe('sk-flat')
    expect(held.secrets.read('decisions.token')).toBeUndefined()
  })

  it('does not overwrite a migrated token when a new flat token arrives later', () => {
    const held = rig({
      values: { [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai' },
      secrets: { 'decisions.token': 'sk-flat' },
    })
    held.run()
    held.secrets.write({ name: 'decisions.token', value: 'typed-after' })
    held.run()

    expect(held.secrets.read('decisions.token.typesafe')).toBe('sk-flat')
    expect(held.secrets.read('decisions.token')).toBe('typed-after')
  })
})
