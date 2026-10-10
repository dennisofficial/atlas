import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { mountInCloud, speaking } from './app-container-cloud-fixture'

await grammarsReady()

afterEach(() => {
  dismissNotice()
})

describe('pressing escape while the cloud socket is down', () => {
  it('refuses the fake interrupt during a reconnect and lets the turn keep running', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      mounted.typeText('keep going')
      mounted.pressEnter()

      const working = await until({
        holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(working).toBe(true)

      bridge.channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })

      const reconnecting = await until({
        holds: async () => (await mounted.nextFrame()).includes('Reconnecting for'),
        within: 20_000,
      })
      expect(reconnecting).toBe(true)

      mounted.pressEscape()

      const warned = await until({
        holds: async () =>
          (await mounted.nextFrame()).includes("esc will interrupt once it's back"),
        within: 20_000,
      })
      expect(warned).toBe(true)
      expect(await mounted.nextFrame()).not.toContain('Interrupting…')

      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      /**
       * The bug this guards: an ungated esc stamps `interrupting` while the label still reads
       * Reconnecting, so nothing looks wrong until the socket comes back — and only then does the
       * turn get stuck reading "Interrupting…" forever, because the local abort never actually
       * settles a cloud-run turn.
       */
      const recovered = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('esc to interrupt') && !frame.includes('Reconnecting for')
        },
        within: 20_000,
      })
      expect(recovered).toBe(true)
      expect(await mounted.nextFrame()).not.toContain('Interrupting…')

      bridge.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-cloud-1') })

      const settled = await until({
        holds: async () => !(await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(settled).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('sending a message to a parked sandbox', () => {
  it('reads as waking rather than working while the sandbox is being woken', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      bridge.channel.moveTo({ state: EChannelConnection.Parked, detail: 'idle past the TTL' })

      mounted.typeText('wake up')
      mounted.pressEnter()

      const waking = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('Waking the sandbox') && !frame.includes('Working for')
        },
        within: 20_000,
      })
      expect(waking).toBe(true)
      expect(await mounted.nextFrame()).toContain('waking')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('reads as reconnecting rather than working while the attachment is being re-created', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      bridge.channel.moveTo({ state: EChannelConnection.Parked, detail: 'idle past the TTL' })

      mounted.typeText('wake up')
      mounted.pressEnter()

      bridge.channel.moveTo({ state: EChannelConnection.Reattaching, detail: null })

      const reattaching = await until({
        holds: async () => {
          const frame = await mounted.nextFrame()
          return frame.includes('Reconnecting for') && !frame.includes('Working for')
        },
        within: 20_000,
      })
      expect(reattaching).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
