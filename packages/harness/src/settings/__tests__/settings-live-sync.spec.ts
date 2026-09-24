import { ATLAS_SETTINGS, ESettingId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSettingsStore } from '../file-store'
import { createSettingsService } from '../service'

const tempStore = (label: string): FileSettingsStore =>
  new FileSettingsStore({
    file: join(mkdtempSync(join(tmpdir(), 'atlas-sync-')), 'settings.json'),
    label,
  })

const sharedStores = (): { file: string; a: FileSettingsStore; b: FileSettingsStore } => {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-sync-')), 'settings.json')
  return {
    file,
    a: new FileSettingsStore({ file, label: 'tile-a' }),
    b: new FileSettingsStore({ file, label: 'tile-b' }),
  }
}

describe('settings merge-on-write across tiles', () => {
  it("a write merges onto the current file instead of reverting another tile's edit", () => {
    const { a, b } = sharedStores()
    const tileA = createSettingsService({ definitions: ATLAS_SETTINGS, user: a })
    const tileB = createSettingsService({ definitions: ATLAS_SETTINGS, user: b })

    tileA.set({ id: ESettingId.SidebarWidth, value: 60 })
    tileB.set({ id: ESettingId.Accent, value: 'moss' })

    const onDisk = a.read().document.values
    expect(onDisk[ESettingId.SidebarWidth]).toBe(60)
    expect(onDisk[ESettingId.Accent]).toBe('moss')
  })

  it('clearing on one tile does not resurrect a value another tile already deleted', () => {
    const { a, b } = sharedStores()
    const tileA = createSettingsService({ definitions: ATLAS_SETTINGS, user: a })
    const tileB = createSettingsService({ definitions: ATLAS_SETTINGS, user: b })

    tileA.set({ id: ESettingId.SidebarWidth, value: 60 })
    tileA.set({ id: ESettingId.Accent, value: 'moss' })

    tileB.clear({ id: ESettingId.Accent })

    const onDisk = a.read().document.values
    expect(onDisk[ESettingId.SidebarWidth]).toBe(60)
    expect(ESettingId.Accent in onDisk).toBe(false)
  })

  it("the writing tile's own snapshot reflects the merged document", () => {
    const { a, b } = sharedStores()
    const tileA = createSettingsService({ definitions: ATLAS_SETTINGS, user: a })
    const tileB = createSettingsService({ definitions: ATLAS_SETTINGS, user: b })

    tileA.set({ id: ESettingId.SidebarWidth, value: 60 })
    tileB.set({ id: ESettingId.Accent, value: 'moss' })

    const tileBSnapshot = tileB.snapshot().resolution
    expect(tileBSnapshot.settings.get(ESettingId.Accent)?.value).toBe('moss')
    expect(tileBSnapshot.settings.get(ESettingId.SidebarWidth)?.value).toBe(60)
  })

  it('a write while the file is unreadable keeps the on-disk settings instead of emptying them', () => {
    const { file, a } = sharedStores()
    const tileA = createSettingsService({ definitions: ATLAS_SETTINGS, user: a })

    tileA.set({ id: ESettingId.SidebarWidth, value: 60 })
    tileA.set({ id: ESettingId.Accent, value: 'moss' })
    writeFileSync(file, '{ torn write', 'utf8')

    expect(tileA.set({ id: ESettingId.SidebarWidth, value: 70 })).toEqual({ ok: true })

    const onDisk = a.read().document.values
    expect(onDisk[ESettingId.SidebarWidth]).toBe(70)
    expect(onDisk[ESettingId.Accent]).toBe('moss')
  })
})
