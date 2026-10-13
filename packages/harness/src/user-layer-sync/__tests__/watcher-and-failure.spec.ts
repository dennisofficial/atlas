import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { UserFileConflict } from '../../cloud/user-files-client'
import type { UserLayerSyncClient } from '../client'
import { watchUserLayer, type UserLayerWatchHandle } from '../watcher'

import { FakeUserFilesServer, makeDevice, readAt, scratchDirectory, writeAt, type Device } from './fixture'

const handles: UserLayerWatchHandle[] = []
const devices: Device[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const device of devices.splice(0)) device.engine.stop()
})

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('watcher', () => {
  it('collapses a burst of writes, including nested ones, into one change', async () => {
    const root = await scratchDirectory('atlas-ulsync-watch')
    await mkdir(join(root, 'review'), { recursive: true })
    let changes = 0
    const handle = watchUserLayer({
      targets: async () => [{ directory: root, recursive: true }],
      onChange: () => {
        changes += 1
      },
      debounceMs: 80,
    })
    handles.push(handle)
    await handle.refresh()

    for (let index = 0; index < 6; index += 1) {
      await writeAt({ path: join(root, 'review', 'SKILL.md'), content: `v${index}` })
    }
    await pause(400)

    expect(changes).toBe(1)
  })

  it('ignores conflict copies and partial writes', async () => {
    const root = await scratchDirectory('atlas-ulsync-watch')
    let changes = 0
    const handle = watchUserLayer({
      targets: async () => [{ directory: root, recursive: false }],
      onChange: () => {
        changes += 1
      },
      debounceMs: 30,
    })
    handles.push(handle)
    await handle.refresh()

    await writeAt({ path: join(root, 'a.conflict-dev.md'), content: 'x' })
    await writeAt({ path: join(root, '.a.md.1234.atlas-partial'), content: 'x' })
    await pause(200)

    expect(changes).toBe(0)
  })
})

describe('non-blocking contract', () => {
  it('start resolves and leaves files on disk when every request fails', async () => {
    const server = new FakeUserFilesServer()
    const failing: UserLayerSyncClient = {
      listUserFiles: async () => {
        throw new Error('api unreachable')
      },
      getUserFiles: async () => {
        throw new Error('api unreachable')
      },
      putUserFile: async () => {
        throw new UserFileConflict({ currentRevision: 1, contentHash: 'x' })
      },
      deleteUserFile: async () => {
        throw new Error('api unreachable')
      },
    }
    const device = await makeDevice({ server, name: 'offline', client: failing })
    devices.push(device)
    await writeAt({ path: join(device.atlasHome, 'memory', 'keep.md'), content: '# keep' })

    await expect(device.engine.start()).resolves.toBeUndefined()
    await expect(device.engine.pullNow()).resolves.toBeUndefined()

    expect(await readAt(join(device.atlasHome, 'memory', 'keep.md'))).toBe('# keep')
    expect(device.log.entries.some((entry) => entry.message.includes('could not pull'))).toBe(true)
  })

  it('start is idempotent and stop is safe to repeat', async () => {
    const server = new FakeUserFilesServer()
    const device = await makeDevice({ server, name: 'twice' })
    devices.push(device)

    await Promise.all([device.engine.start(), device.engine.start()])
    device.engine.stop()
    device.engine.stop()
  })
})
