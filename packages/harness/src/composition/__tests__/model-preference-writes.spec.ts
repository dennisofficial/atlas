import { describe, expect, it } from 'bun:test'
import { ATLAS_SETTINGS, EEffort, ESettingId } from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { rememberSettingModel } from '../model-preference'

const selection = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-5' },
  effort: EEffort.High,
}

describe('model preference write failures', () => {
  it('returns the model write refusal without trying to save effort', () => {
    const settings = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ refuse: 'read-only file system' }),
    })

    expect(rememberSettingModel({
      settings, target: { id: ESettingId.ModelId, withEffort: true }, selection,
    })).toEqual({ ok: false, message: 'read-only file system' })
    expect(settings.version()).toBe(0)
  })

  it('returns the effort refusal after a successful model write', () => {
    let writes = 0
    const store = new MemorySettingsStore()
    const settings = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: {
        origin: () => 'memory',
        read: () => store.read(),
        write: (document) => {
          writes += 1
          if (writes === 2) throw new Error('effort write failed')
          store.write(document)
        },
      },
    })

    expect(rememberSettingModel({
      settings, target: { id: ESettingId.ModelId, withEffort: true }, selection,
    })).toEqual({ ok: false, message: 'effort write failed' })
    expect(store.document().values[ESettingId.ModelId]).toBe('anthropic/claude-sonnet-5')
    expect(store.document().values[ESettingId.ModelEffort]).toBeUndefined()
  })
})
