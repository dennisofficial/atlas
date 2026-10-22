import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createUserLayerSync } from '../factory'

import {
  FakeUserFilesServer,
  hashOf,
  makeDevice,
  namesIn,
  readAt,
  waitFor,
  writeAt,
  type Device,
} from './fixture'

const devices: Device[] = []
const track = async (args: Parameters<typeof makeDevice>[0]): Promise<Device> => {
  const device = await makeDevice(args)
  devices.push(device)
  return device
}

afterEach(() => {
  for (const device of devices.splice(0)) device.engine.stop()
})

describe('two-device convergence', () => {
  it('carries skills and instructions from A to B and back, including an edit', async () => {
    const server = new FakeUserFilesServer()
    const a = await track({ server, name: 'a' })
    const b = await track({ server, name: 'b' })

    await writeAt({ path: join(a.atlasHome, 'skills', 'review', 'SKILL.md'), content: '# review' })
    await writeAt({
      path: join(a.home, '.agents', 'skills', 'explore', 'SKILL.md'),
      content: '# explore',
    })
    await writeAt({ path: join(a.atlasHome, 'ATLAS.md'), content: '# global' })
    await writeAt({ path: join(a.atlasHome, 'skills', 'topic.md'), content: '# topic' })
    await a.engine.start()

    await b.engine.pullNow()
    expect(await readAt(join(b.atlasHome, 'skills', 'review', 'SKILL.md'))).toBe('# review')
    expect(await readAt(join(b.home, '.agents', 'skills', 'explore', 'SKILL.md'))).toBe('# explore')
    expect(await readAt(join(b.atlasHome, 'ATLAS.md'))).toBe('# global')
    expect(await readAt(join(b.atlasHome, 'skills', 'topic.md'))).toBe('# topic')
    expect(server.row({ tree: 'skills', path: '.atlas/topic.md' })?.contentHash).toBe(
      hashOf('# topic'),
    )

    await writeAt({
      path: join(b.atlasHome, 'skills', 'topic.md'),
      content: '# topic, edited on B',
    })
    await b.engine.reconcileNow()
    await a.engine.pullNow()
    expect(await readAt(join(a.atlasHome, 'skills', 'topic.md'))).toBe('# topic, edited on B')
    expect(server.row({ tree: 'skills', path: '.atlas/topic.md' })?.revision).toBe(2)
  })

  it('does not push back what a pull just wrote', async () => {
    const server = new FakeUserFilesServer()
    const a = await track({ server, name: 'a' })
    const b = await track({ server, name: 'b' })
    await writeAt({ path: join(a.atlasHome, 'skills', 'one.md'), content: '# one' })
    await a.engine.start()
    const putsAfterA = server.puts.length

    await b.engine.start()
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(server.puts.length).toBe(putsAfterA)
    expect(await readAt(join(b.atlasHome, 'skills', 'one.md'))).toBe('# one')
  })

  it('pushes a file written while the watchers run, and tombstones a removed one', async () => {
    const server = new FakeUserFilesServer()
    const a = await track({ server, name: 'a' })
    await writeAt({ path: join(a.atlasHome, 'skills', 'seed.md'), content: '# seed' })
    await a.engine.start()

    await writeAt({ path: join(a.atlasHome, 'skills', 'live.md'), content: '# live' })
    await waitFor(() => server.text({ tree: 'skills', path: '.atlas/live.md' }) === '# live')

    await rm(join(a.atlasHome, 'skills', 'live.md'))
    await waitFor(
      () => server.row({ tree: 'skills', path: '.atlas/live.md' })?.tombstonedAt != null,
    )
    expect(server.row({ tree: 'skills', path: '.atlas/live.md' })?.revision).toBe(2)
  })

  it('persists one device id across engine restarts', async () => {
    const server = new FakeUserFilesServer()
    const a = await track({ server, name: 'a' })
    await a.engine.start()
    const first = await a.deviceId()
    a.engine.stop()

    const again = createUserLayerSync({
      atlasHome: a.atlasHome,
      home: a.home,
      client: a.client,
      log: a.log,
    })
    await again.pullNow()
    again.stop()

    expect(await a.deviceId()).toBe(first)
    expect(first.length).toBeGreaterThan(8)
    expect(await namesIn(join(a.atlasHome, 'sync'))).toEqual(['user-layer-sync.json'])
  })
})
