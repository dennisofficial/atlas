import { ATLAS_SETTINGS, ESettingId, serialiseSettingsDocument } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileSettingsStore } from '../../settings/file-store'
import { createSettingsService } from '../../settings/service'
import type { ChannelReady } from '../remote-delta-channel'
import { bindChannelSettingsSync } from '../settings-channel-sync'

const fixture = () => {
  const settings = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new FileSettingsStore({
      file: join(mkdtempSync(join(tmpdir(), 'atlas-channel-sync-')), 'settings.json'),
      label: 'user',
    }),
  })
  const syncs: string[] = []
  const readies = new Set<(ready: ChannelReady) => void>()
  const channel = {
    syncSettings: ({ content }: { content: string }): void => {
      syncs.push(content)
    },
    onReady: (listener: (ready: ChannelReady) => void) => {
      readies.add(listener)
      return () => {
        readies.delete(listener)
      }
    },
  }
  const emitReady = (): void => {
    for (const listener of [...readies]) listener({ turnInFlight: false })
  }
  const dispose = bindChannelSettingsSync({ channel, settings })
  const currentContent = (): string => serialiseSettingsDocument(settings.snapshot().document)
  return { settings, syncs, emitReady, dispose, currentContent, readyListeners: () => readies.size }
}

describe('bindChannelSettingsSync', () => {
  it('sends nothing until the channel is ready, then uploads the current document', () => {
    const { syncs, emitReady, currentContent } = fixture()
    expect(syncs).toEqual([])

    emitReady()

    expect(syncs).toEqual([currentContent()])
  })

  it('sends the new document exactly once after a settings change', () => {
    const { settings, syncs, emitReady, currentContent } = fixture()
    emitReady()

    settings.set({ id: ESettingId.SidebarWidth, value: 60 })

    expect(syncs).toHaveLength(2)
    expect(syncs[1]).toBe(currentContent())
    expect(syncs[1]).not.toBe(syncs[0])
  })

  it('sends nothing when a publish leaves the user document unchanged', () => {
    const { settings, syncs, emitReady } = fixture()
    emitReady()

    settings.register([])
    settings.set({ id: ESettingId.SidebarWidth, value: 60 })
    const afterChange = syncs.length
    settings.set({ id: ESettingId.SidebarWidth, value: 60 })
    settings.register([])

    expect(syncs).toHaveLength(afterChange)
  })

  it('re-sends on a second ready even though nothing changed in between', () => {
    const { syncs, emitReady } = fixture()
    emitReady()
    emitReady()

    expect(syncs).toHaveLength(2)
    expect(syncs[1]).toBe(syncs[0])
  })

  it('stops listening to both sources once disposed', () => {
    const { settings, syncs, emitReady, dispose, readyListeners } = fixture()
    dispose()

    settings.set({ id: ESettingId.SidebarWidth, value: 60 })
    emitReady()

    expect(syncs).toEqual([])
    expect(readyListeners()).toBe(0)
  })
})
