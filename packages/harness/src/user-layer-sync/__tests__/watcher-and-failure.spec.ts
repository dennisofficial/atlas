import { afterEach, describe, expect, it } from 'vitest'
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

const MAX_PROBE_ATTEMPTS = 20

const QUIET_MS = 300

const MAX_QUIET_ROUNDS = 10

async function settledCount(args: { read: () => number }): Promise<number> {
  for (let round = 0; round < MAX_QUIET_ROUNDS; round += 1) {
    const before = args.read()
    await pause(QUIET_MS)
    if (args.read() === before) return before
  }
  throw new Error(`the watcher never went quiet after ${MAX_QUIET_ROUNDS} rounds`)
}

describe('watcher', () => {
  it('collapses a burst of writes, including nested ones, into one change', async () => {
    const root = await scratchDirectory('atlas-ulsync-watch')
    await mkdir(join(root, 'review'), { recursive: true })
    let changes = 0
    let notifyChange: () => void = () => undefined
    const handle = watchUserLayer({
      targets: async () => [{ directory: root, recursive: true }],
      onChange: () => {
        changes += 1
        notifyChange()
      },
      debounceMs: 80,
    })
    handles.push(handle)
    await handle.refresh()

    const probe = join(root, 'review', 'probe.md')
    for (let attempt = 0; changes === 0 && attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
      const delivered = new Promise<void>((resolve) => {
        notifyChange = resolve
      })
      await writeAt({ path: probe, content: `probe${attempt}` })
      await Promise.race([delivered, pause(150)])
    }
    expect(changes).toBeGreaterThan(0)
    const changesBeforeBurst = await settledCount({ read: () => changes })

    for (let index = 0; index < 6; index += 1) {
      await writeAt({ path: join(root, 'review', 'SKILL.md'), content: `v${index}` })
    }
    await pause(400)

    expect(changes - changesBeforeBurst).toBe(1)
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
    await writeAt({ path: join(device.atlasHome, 'skills', 'keep.md'), content: '# keep' })

    await expect(device.engine.start()).resolves.toBeUndefined()
    await expect(device.engine.pullNow()).resolves.toBeUndefined()

    expect(await readAt(join(device.atlasHome, 'skills', 'keep.md'))).toBe('# keep')
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
