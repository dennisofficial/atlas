import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EImageDelivery, toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import type { ClipboardImage, ClipboardImageReader } from '../../ui/clipboard-image'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { until, THREAD } from './app-fixture'
import { mount, slowlySpeaking } from './app-container-cloud-fixture'

await grammarsReady()

const STEER = 'check the tests too'

const TAKE_BACK = '↑ to edit'

const tinyPng = (): Buffer => {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(560, 16)
  header.writeUInt32BE(280, 20)
  return header
}

const onTheClipboard = (): ClipboardImageReader => {
  const bytes = tinyPng()
  const path = join(mkdtempSync(join(tmpdir(), 'atlas-paste-')), 'shot.png')
  writeFileSync(path, bytes)

  return async (): Promise<ClipboardImage> => ({
    path,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: 560,
    height: 280,
    delivery: EImageDelivery.Inline,
    tokens: 200,
  })
}

type Mounted = Awaited<ReturnType<typeof mount>>

const liftMidTurn = async (mounted: Mounted, bridge: FakeBridge): Promise<void> => {
  await mounted.typeText('keep going')
  mounted.pressEnter()

  const working = await until({
    holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
    within: 20_000,
  })
  expect(working).toBe(true)

  await mounted.typeText('/container cloud')
  mounted.pressEnter()

  const attached = await until({
    holds: async () => bridge.attached.length === 1,
    within: 20_000,
  })
  expect(attached).toBe(true)

  const resumed = await until({
    holds: async () => bridge.channel.runs === 1,
    within: 20_000,
  })
  expect(resumed).toBe(true)
}

describe('steering a turn that runs in the cloud', () => {
  it('forwards a message typed mid-turn to the sandbox instead of queueing it locally', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await liftMidTurn(mounted, bridge)

      await mounted.typeText(STEER)
      mounted.pressEnter()

      const forwarded = await until({
        holds: async () => bridge.channel.sent.some((one) => one.text === STEER),
        within: 20_000,
      })
      expect(forwarded).toBe(true)
      expect(app.pending.forThread({ threadId: THREAD }).getSnapshot()).toEqual([])
      expect(await mounted.frame()).not.toContain(TAKE_BACK)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-resume') })

      const settled = await until({
        holds: async () => !(await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(settled).toBe(true)
      await mounted.frame()

      await mounted.say('and ship it')

      const ranAgain = await until({
        holds: async () => bridge.channel.runs === 2,
        within: 20_000,
      })
      expect(ranAgain).toBe(true)
      expect(bridge.channel.sent.filter((one) => one.text !== STEER)).toEqual([])

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-2') })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('queues an image locally with a notice, since a Send frame carries text only', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge, clipboard: onTheClipboard() })

    try {
      await liftMidTurn(mounted, bridge)

      mounted.pressCtrl('v')
      const tagged = await until({
        holds: async () => (await mounted.nextFrame()).includes('[Image #1]'),
        within: 20_000,
      })
      expect(tagged).toBe(true)

      await mounted.typeText(STEER)
      mounted.pressEnter()

      const noticed = await until({
        holds: async () => (await mounted.nextFrame()).includes("can't steer a running cloud turn"),
        within: 20_000,
      })
      expect(noticed).toBe(true)
      expect(bridge.channel.sent).toEqual([])
      expect(app.pending.forThread({ threadId: THREAD }).getSnapshot()).toHaveLength(1)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-resume') })
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
