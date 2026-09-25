import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { open, promiseGate, spokenIn, until } from './app-fixture'
import { mount, speaking } from './app-container-cloud-fixture'

await grammarsReady()

const SENDING = 'sending'
const DID_NOT_SEND = "didn't send"

describe('a message waiting on the cloud round trip', () => {
  it('shows the message as sending until the commit lands, then as the durable row', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      const gated = promiseGate()
      const held = bridge.log.append.bind(bridge.log)
      bridge.log.append = async (call: Parameters<typeof held>[0]) => {
        await gated.gate
        return held(call)
      }

      await mounted.typeText('look at this remotely')
      mounted.pressEnter()

      const shown = await until({
        holds: async () => (await mounted.nextFrame()).includes(SENDING),
        within: 20_000,
      })
      expect(shown).toBe(true)

      gated.release()
      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-send-1') })

      const resolved = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('look at this remotely') && !frame.includes(SENDING)
        },
        within: 20_000,
      })
      expect(resolved).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows a steered message as sending while the turn is running, clearing it when it lands', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      await mounted.typeText('keep going')
      mounted.pressEnter()

      const working = await until({
        holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(working).toBe(true)

      await mounted.typeText('check the tests too')
      mounted.pressEnter()

      const shown = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('check the tests too') && frame.includes(SENDING)
        },
        within: 20_000,
      })
      expect(shown).toBe(true)

      bridge.channel.commitSaid({ text: 'check the tests too' })
      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-send-2') })

      const cleared = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return !frame.includes(SENDING) && frame.includes('check the tests too')
        },
        within: 20_000,
      })
      expect(cleared).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('downgrades the row to a send failure when the socket dies before the commit answers', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      let dropCommit: (error: Error) => void = () => undefined
      const commitFate = new Promise<never>((_, reject) => {
        dropCommit = reject
      })
      commitFate.catch(() => undefined)
      const held = bridge.log.append.bind(bridge.log)
      let first = true
      bridge.log.append = async (call: Parameters<typeof held>[0]) => {
        if (first) {
          first = false
          await commitFate
        }
        return held(call)
      }

      await mounted.typeText('this never arrives')
      mounted.pressEnter()

      const shown = await until({
        holds: async () => (await mounted.nextFrame()).includes(SENDING),
        within: 20_000,
      })
      expect(shown).toBe(true)

      bridge.channel.moveTo({ state: EChannelConnection.Closed, detail: 'socket dropped' })
      dropCommit(new Error('socket dropped'))

      const failed = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes(DID_NOT_SEND) && frame.includes('this never arrives')
        },
        within: 20_000,
      })
      expect(failed).toBe(true)

      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await mounted.typeText('this never arrives')
      mounted.pressEnter()

      const resent = await until({
        holds: async () =>
          bridge.log
            .peek({ threadId: bridge.channel.threadId })
            .some((event) => event.type === 'user-said' && event.text === 'this never arrives'),
        within: 20_000,
      })
      expect(resent).toBe(true)

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-send-3') })

      const gone = await until({
        holds: async () => !(await mounted.nextFrame()).includes(DID_NOT_SEND),
        within: 20_000,
      })
      expect(gone).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('a message sent on a local thread', () => {
  it('reads as sending until the commit lands, and never reaches the queued take-back', async () => {
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      const gated = promiseGate()
      const held = app.log.append.bind(app.log)
      app.log.append = async (call: Parameters<typeof held>[0]) => {
        await gated.gate
        return held(call)
      }

      await mounted.typeText('a local beat of feedback')
      mounted.pressEnter()

      const shown = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes(SENDING) && frame.includes('a local beat of feedback')
        },
        within: 20_000,
      })
      expect(shown).toBe(true)
      expect(await mounted.nextFrame()).not.toContain('↑ to edit')

      gated.release()

      const resolved = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('a local beat of feedback') && !frame.includes(SENDING)
        },
        within: 20_000,
      })
      expect(resolved).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the message as a send failure when the commit refuses, then clears once it lands', async () => {
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      const held = app.log.append.bind(app.log)
      let refusing = true
      app.log.append = async (call: Parameters<typeof held>[0]) => {
        if (refusing) throw new Error('disk full')
        return held(call)
      }

      await mounted.typeText('this one bounces')
      mounted.pressEnter()

      const failed = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes(DID_NOT_SEND) && frame.includes('this one bounces')
        },
        within: 20_000,
      })
      expect(failed).toBe(true)

      refusing = false

      await mounted.typeText('this one bounces')
      mounted.pressEnter()

      const cleared = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return !frame.includes(DID_NOT_SEND) && frame.includes('this one bounces')
        },
        within: 20_000,
      })
      expect(cleared).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
