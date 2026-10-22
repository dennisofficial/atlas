import { ATLAS_SETTINGS, ESettingId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSettingsStore } from '../file-store'
import { createSettingsService } from '../service'

const tempStore = (): { file: string; store: FileSettingsStore } => {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-apply-')), 'settings.json')
  return { file, store: new FileSettingsStore({ file, label: 'serve' }) }
}

describe('applyUserDocument', () => {
  it('writes the incoming document wholesale: sets, updates and clears in one publish', () => {
    const { store } = tempStore()
    const service = createSettingsService({ definitions: ATLAS_SETTINGS, user: store })

    service.set({ id: ESettingId.SidebarWidth, value: 60 })
    service.set({ id: ESettingId.Accent, value: 'moss' })

    let publishes = 0
    service.subscribe(() => {
      publishes += 1
    })
    const versionBefore = service.version()

    const result = service.applyUserDocument({
      values: { [ESettingId.Accent]: 'pine', 'model.id': 'claude-opus-4-6' },
    })

    expect(result).toEqual({ ok: true })
    expect(service.version()).toBe(versionBefore + 1)
    expect(publishes).toBe(1)

    const onDisk = store.read().document.values
    expect(onDisk[ESettingId.Accent]).toBe('pine')
    expect(onDisk['model.id']).toBe('claude-opus-4-6')
    expect(ESettingId.SidebarWidth in onDisk).toBe(false)
  })

  it('an identical document is a no-op: no write, no publish', () => {
    const { store } = tempStore()
    const service = createSettingsService({ definitions: ATLAS_SETTINGS, user: store })

    service.set({ id: ESettingId.Accent, value: 'moss' })
    const versionBefore = service.version()

    const result = service.applyUserDocument({ values: { [ESettingId.Accent]: 'moss' } })

    expect(result).toEqual({ ok: true })
    expect(service.version()).toBe(versionBefore)
  })

  it('strips $-prefixed reserved keys from the incoming document', () => {
    const { store } = tempStore()
    const service = createSettingsService({ definitions: ATLAS_SETTINGS, user: store })

    const result = service.applyUserDocument({
      values: { $internal: 'no', [ESettingId.Accent]: 'moss' },
    })

    expect(result).toEqual({ ok: true })
    const onDisk = store.read().document.values
    expect('$internal' in onDisk).toBe(false)
    expect(onDisk[ESettingId.Accent]).toBe('moss')
  })
})
