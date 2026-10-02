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

      const saidAgain = await until({
        holds: async () => bridge.channel.sent.some((one) => one.text === 'and ship it'),
        within: 20_000,
      })
      expect(saidAgain).toBe(true)
      expect(bridge.channel.runs).toBe(1)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-2') })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('steers a running cloud turn with an image attached, forwarding it to the sandbox', async () => {
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

      const forwarded = await until({
        holds: async () =>
          bridge.channel.sent.some((one) => one.text.endsWith(STEER) && one.images?.length === 1),
        within: 20_000,
      })
      expect(forwarded).toBe(true)

      const steered = bridge.channel.sent.find((one) => one.text.endsWith(STEER))
      expect(steered?.images?.[0]?.mediaType).toBe('image/png')
      expect(app.pending.forThread({ threadId: THREAD }).getSnapshot()).toEqual([])
      expect(await mounted.frame()).not.toContain(TAKE_BACK)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-resume') })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('renders the sandbox queue the channel broadcasts, and ↑ takes the last entry back into the draft', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await liftMidTurn(mounted, bridge)

      bridge.channel.pushPending([
        { id: 'pending-1', text: STEER, reserved: false },
      ])

      const shown = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes(STEER) && frame.includes(TAKE_BACK)
        },
        within: 20_000,
      })
      expect(shown).toBe(true)

      bridge.channel.holdTakeBack({ text: STEER, images: [], files: [] })
      mounted.pressUp()

      const recalled = await until({
        holds: async () => mounted.draftText() === STEER,
        within: 20_000,
      })
      expect(recalled).toBe(true)

      const rowGone = await until({
        holds: async () => !(await mounted.nextFrame()).includes(TAKE_BACK),
        within: 20_000,
      })
      expect(rowGone).toBe(true)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-take-back') })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('leaves the row and the draft alone when the sandbox has nothing left to take back', async () => {
    const app = slowlySpeaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await liftMidTurn(mounted, bridge)

      bridge.channel.pushPending([
        { id: 'pending-1', text: STEER, reserved: false },
      ])

      const shown = await until({
        holds: async () => (await mounted.nextFrame()).includes(TAKE_BACK),
        within: 20_000,
      })
      expect(shown).toBe(true)

      // The intake claimed the message before the ↑ landed: the take-back comes back empty.
      bridge.channel.holdTakeBack(null)
      mounted.pressUp()

      await mounted.frame()
      expect(mounted.draftText()).toBe('')

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-too-late') })
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
