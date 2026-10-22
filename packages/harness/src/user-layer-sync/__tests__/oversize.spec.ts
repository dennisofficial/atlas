import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { ENoticeTone, NOTICE_WARN_MS } from '@dltech/atlas-core'

import { MAX_USER_LAYER_FILE_BYTES } from '../limits'

import { FakeUserFilesServer, makeDevice, RecordingNotice, writeAt, type Device } from './fixture'

const devices: Device[] = []
afterEach(() => {
  for (const device of devices.splice(0)) device.engine.stop()
})

const setup = async () => {
  const server = new FakeUserFilesServer()
  const notice = new RecordingNotice()
  const device = await makeDevice({ server, name: 'oversize', notice })
  devices.push(device)
  return { server, notice, device, big: join(device.atlasHome, 'skills', 'big.md') }
}

const overCap = 'a'.repeat(3_400_000)
const oneOverCap = 'a'.repeat(MAX_USER_LAYER_FILE_BYTES + 1)
const atCap = 'a'.repeat(MAX_USER_LAYER_FILE_BYTES)

describe('user-layer upload cap', () => {
  it('never uploads an oversize file, warns once per pass and records no state', async () => {
    const { server, notice, device, big } = await setup()
    await writeAt({ path: big, content: overCap })

    await device.engine.reconcileNow()

    expect(server.puts).toEqual([])
    expect(notice.posts).toEqual([
      {
        key: 'user-layer-oversize:skills/.atlas/big.md',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: 'not syncing skills/.atlas/big.md to Atlas Cloud: 3.4 MB is over the 3.0 MB limit',
      },
    ])
    expect(
      device.log.entries.some((entry) =>
        entry.message.includes('not syncing skills/.atlas/big.md'),
      ),
    ).toBe(true)
    const state = JSON.parse(
      await Bun.file(join(device.atlasHome, 'sync', 'user-layer-sync.json')).text(),
    ) as {
      trees: Record<string, Record<string, unknown>>
    }
    expect(state.trees['skills']?.['.atlas/big.md']).toBeUndefined()

    await device.engine.reconcileNow()
    expect(notice.posts).toHaveLength(2)
    expect(new Set(notice.posts.map((post) => post.key)).size).toBe(1)
  })

  it('uploads a file exactly at the cap', async () => {
    const { server, notice, device, big } = await setup()
    await writeAt({ path: big, content: atCap })

    await device.engine.reconcileNow()

    expect(server.puts).toEqual(['skills/.atlas/big.md'])
    expect(notice.posts).toEqual([])
  })

  it('skips a file one byte over the cap', async () => {
    const { server, device, big } = await setup()
    await writeAt({ path: big, content: oneOverCap })

    await device.engine.reconcileNow()

    expect(server.puts).toEqual([])
  })

  it('uploads the file once it shrinks under the cap', async () => {
    const { server, device, big } = await setup()
    await writeAt({ path: big, content: overCap })
    await device.engine.reconcileNow()
    expect(server.puts).toEqual([])

    await writeAt({ path: big, content: 'small' })
    await device.engine.reconcileNow()

    expect(server.text({ tree: 'skills', path: '.atlas/big.md' })).toBe('small')
  })

  it('still syncs the other files in the tree', async () => {
    const { server, notice, device, big } = await setup()
    await writeAt({ path: big, content: overCap })
    await writeAt({ path: join(device.atlasHome, 'skills', 'small.md'), content: 'ok' })

    await device.engine.reconcileNow()

    expect(server.puts).toEqual(['skills/.atlas/small.md'])
    expect(notice.posts).toHaveLength(1)
  })

  it('logs without a notice port', async () => {
    const server = new FakeUserFilesServer()
    const device = await makeDevice({ server, name: 'no-notice' })
    devices.push(device)
    await writeAt({ path: join(device.atlasHome, 'skills', 'big.md'), content: overCap })

    await device.engine.reconcileNow()

    expect(server.puts).toEqual([])
    expect(device.log.entries.some((entry) => entry.message.includes('not syncing'))).toBe(true)
  })
})
