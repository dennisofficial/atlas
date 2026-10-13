import { afterEach, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { FakeUserFilesServer, makeDevice, namesIn, readAt, writeAt, type Device } from './fixture'

const devices: Device[] = []
const track = async (args: Parameters<typeof makeDevice>[0]): Promise<Device> => {
  const device = await makeDevice(args)
  devices.push(device)
  return device
}

afterEach(() => {
  for (const device of devices.splice(0)) device.engine.stop()
})

const syncedPair = async (args: { path: string; content: string }) => {
  const server = new FakeUserFilesServer()
  const a = await track({ server, name: 'a' })
  const b = await track({ server, name: 'b' })
  await writeAt({ path: join(a.atlasHome, args.path), content: args.content })
  await a.engine.start()
  await b.engine.pullNow()
  return { server, a, b }
}

describe('push conflict', () => {
  it('a stale writer gets the remote copy and keeps its own as a conflict copy', async () => {
    const { server, a, b } = await syncedPair({ path: 'memory/topic.md', content: 'v1' })

    await writeAt({ path: join(a.atlasHome, 'memory', 'topic.md'), content: 'from A' })
    await a.engine.reconcileNow()
    await writeAt({ path: join(b.atlasHome, 'memory', 'topic.md'), content: 'from B' })
    await b.engine.reconcileNow()

    const deviceId = await b.deviceId()
    expect(await readAt(join(b.atlasHome, 'memory', 'topic.md'))).toBe('from A')
    expect(await readAt(join(b.atlasHome, 'memory', `topic.conflict-${deviceId}.md`))).toBe('from B')
    expect(server.text({ tree: 'memory', path: 'user/topic.md' })).toBe('from A')
  })

  it('never pushes conflict copies', async () => {
    const { server, a, b } = await syncedPair({ path: 'memory/topic.md', content: 'v1' })
    await writeAt({ path: join(a.atlasHome, 'memory', 'topic.md'), content: 'from A' })
    await a.engine.reconcileNow()
    await writeAt({ path: join(b.atlasHome, 'memory', 'topic.md'), content: 'from B' })
    await b.engine.reconcileNow()
    await b.engine.reconcileNow()

    const paths = [...server.rows.keys()]
    expect(paths.some((key) => key.includes('.conflict-'))).toBe(false)
    expect(await namesIn(join(b.atlasHome, 'memory'))).toHaveLength(2)
  })
})

describe('tombstone grace rule', () => {
  it('an offline edit survives a remote delete as a conflict copy', async () => {
    const { server, a, b } = await syncedPair({ path: 'memory/note.md', content: 'v1' })
    await rm(join(b.atlasHome, 'memory', 'note.md'))
    await b.engine.reconcileNow()
    expect(server.row({ tree: 'memory', path: 'user/note.md' })?.tombstonedAt).not.toBeNull()

    await writeAt({ path: join(a.atlasHome, 'memory', 'note.md'), content: 'edited offline' })
    await a.engine.pullNow()

    const deviceId = await a.deviceId()
    expect(await namesIn(join(a.atlasHome, 'memory'))).toEqual([`note.conflict-${deviceId}.md`])
    expect(await readAt(join(a.atlasHome, 'memory', `note.conflict-${deviceId}.md`))).toBe('edited offline')
  })

  it('removes an untouched local copy without leaving a conflict copy', async () => {
    const { a, b } = await syncedPair({ path: 'memory/note.md', content: 'v1' })

    await rm(join(b.atlasHome, 'memory', 'note.md'))
    await b.engine.reconcileNow()
    await a.engine.pullNow()

    expect(await namesIn(join(a.atlasHome, 'memory'))).toEqual([])
  })
})
