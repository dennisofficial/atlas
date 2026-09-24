import { ATLAS_SETTINGS, ESettingId } from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSettingsStore } from '../file-store'
import { MemorySettingsStore } from '../memory-store'
import { createSettingsService, type SettingsService } from '../service'

const DEBOUNCE_MS = 25

const settled = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const fileStore = (): { file: string; store: FileSettingsStore } => {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-watch-')), 'settings.json')
  return { file, store: new FileSettingsStore({ file, label: 'user' }) }
}

const watchedService = (args: { file: string; store: FileSettingsStore }): SettingsService =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: args.store,
    watch: { files: [args.file], debounceMs: DEBOUNCE_MS },
  })

describe('settings file watching across tiles', () => {
  const services: SettingsService[] = []

  afterEach(() => {
    for (const service of services.splice(0)) service.close()
  })

  it('republishes when another process writes the file', async () => {
    const { file, store } = fileStore()
    const service = watchedService({ file, store })
    services.push(service)

    let told = 0
    service.subscribe(() => {
      told += 1
    })

    const other = new FileSettingsStore({ file, label: 'other-tile' })
    other.write({ values: { [ESettingId.Accent]: 'moss' } })
    await settled(DEBOUNCE_MS * 6)

    expect(told).toBeGreaterThan(0)
    expect(service.snapshot().resolution.settings.get(ESettingId.Accent)?.value).toBe('moss')
  })

  it('stays silent when its own write lands', async () => {
    const { file, store } = fileStore()
    const service = watchedService({ file, store })
    services.push(service)

    service.set({ id: ESettingId.Accent, value: 'moss' })

    let told = 0
    service.subscribe(() => {
      told += 1
    })
    await settled(DEBOUNCE_MS * 6)

    expect(told).toBe(0)
    expect(service.version()).toBe(1)
  })

  it('arms when the file first appears after boot', async () => {
    const { file, store } = fileStore()
    const service = watchedService({ file, store })
    services.push(service)

    await settled(DEBOUNCE_MS * 4)
    const other = new FileSettingsStore({ file, label: 'other-tile' })
    other.write({ values: { [ESettingId.Accent]: 'plum' } })
    await settled(DEBOUNCE_MS * 8)

    expect(service.snapshot().resolution.settings.get(ESettingId.Accent)?.value).toBe('plum')
  })

  it('keeps serving the held snapshot when the file is briefly unreadable mid-write', async () => {
    const { file, store } = fileStore()
    const service = watchedService({ file, store })
    services.push(service)
    service.set({ id: ESettingId.Accent, value: 'moss' })

    writeFileSync(file, '{ partial', 'utf8')
    await settled(DEBOUNCE_MS * 6)

    const held = service.snapshot().resolution.settings.get(ESettingId.Accent)
    expect(held?.value).toBe('moss')
  })

  it('republishes when the project file changes even though the user file did not', async () => {
    const userFile = join(mkdtempSync(join(tmpdir(), 'atlas-watch-user-')), 'settings.json')
    const projectFile = join(mkdtempSync(join(tmpdir(), 'atlas-watch-project-')), 'settings.json')
    const service = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new FileSettingsStore({ file: userFile, label: 'user' }),
      project: new FileSettingsStore({ file: projectFile, label: 'project' }),
      watch: { files: [userFile, projectFile], debounceMs: DEBOUNCE_MS },
    })
    services.push(service)

    let told = 0
    service.subscribe(() => {
      told += 1
    })

    new FileSettingsStore({ file: projectFile, label: 'other' }).write({
      values: { [ESettingId.SidebarWidth]: 60 },
    })
    await settled(DEBOUNCE_MS * 6)

    expect(told).toBeGreaterThan(0)
    const held = service.snapshot().resolution.settings.get(ESettingId.SidebarWidth)
    expect(held?.value).toBe(60)
    expect(held?.origin).toBe('project')
  })

  it('keeps live-syncing after an unrelated cloud write failure', async () => {
    const { file, store } = fileStore()
    const failingCloud = {
      signedIn: () => true,
      values: () => ({}),
      set: async () => {
        throw new Error('cloud is down')
      },
      remove: async () => undefined,
      subscribe: () => () => undefined,
    }
    const service = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: store,
      cloud: failingCloud,
      watch: { files: [file], debounceMs: DEBOUNCE_MS },
    })
    services.push(service)

    // A failed cloud save leaves a problem on the snapshot; file watching must still work.
    service.set({ id: 'sandbox.image', value: 'x' })
    await settled(DEBOUNCE_MS * 4)

    const other = new FileSettingsStore({ file, label: 'other-tile' })
    other.write({ values: { [ESettingId.Accent]: 'plum' } })
    await settled(DEBOUNCE_MS * 6)

    expect(service.snapshot().resolution.settings.get(ESettingId.Accent)?.value).toBe('plum')
  })

  it('a write that creates the file in a previously unwatched directory re-arms the watch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-watch-new-'))
    const file = join(root, 'nested', 'settings.json')
    const store = new FileSettingsStore({ file, label: 'user' })
    const service = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: store,
      watch: { files: [file], debounceMs: DEBOUNCE_MS },
    })
    services.push(service)

    expect(service.set({ id: ESettingId.Accent, value: 'moss' })).toEqual({ ok: true })

    // The directory existed only after that write; an external edit must now be picked up.
    await settled(DEBOUNCE_MS * 4)
    new FileSettingsStore({ file, label: 'other-tile' }).write({
      values: { [ESettingId.Accent]: 'plum' },
    })
    await settled(DEBOUNCE_MS * 6)

    expect(service.snapshot().resolution.settings.get(ESettingId.Accent)?.value).toBe('plum')
  })
})
