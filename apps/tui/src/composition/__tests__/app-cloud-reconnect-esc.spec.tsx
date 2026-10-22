import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { EConnectionView, ETurnStatus } from '@dltech/atlas-harness'

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
      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })

      mounted.typeText('keep going')
      mounted.pressEnter()

      const working = await until({
        holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(working).toBe(true)

      bridge.channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })

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

      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })

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

describe('pressing escape while the pod is updating', () => {
  it('names the update in the row and refuses the interrupt with the updating text', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })

    try {
      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })

      mounted.typeText('keep going')
      mounted.pressEnter()

      expect(
        await until({
          holds: async () => (await mounted.nextFrame()).includes('esc to interrupt'),
          within: 20_000,
        }),
      ).toBe(true)

      bridge.channel.moveTo({ state: EConnectionView.Updating, detail: 'updating the pod' })

      expect(
        await until({
          holds: async () => (await mounted.nextFrame()).includes('Updating the pod for'),
          within: 20_000,
        }),
      ).toBe(true)

      mounted.pressEscape()

      expect(
        await until({
          holds: async () =>
            (await mounted.nextFrame()).includes(
              'the pod is updating — esc will interrupt once it is back',
            ),
          within: 20_000,
        }),
      ).toBe(true)
      expect(await mounted.nextFrame()).not.toContain('Interrupting…')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('sending a message to a parked sandbox', () => {
  it('queues it here, wakes the sandbox once, and sends nothing until the channel greets', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app, bridge })
    const create = bridge.sandboxes.create
    let releaseWake: () => void = () => undefined
    const wakeHeld = new Promise<void>((resolve) => {
      releaseWake = resolve
    })
    bridge.sandboxes.create = async (args) => {
      await wakeHeld
      return create(args)
    }

    try {
      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })
      bridge.channel.moveTo({ state: EConnectionView.Parked, detail: null })
      expect(
        await until({
          holds: async () => (await mounted.nextFrame()).includes('☾'),
          within: 20_000,
        }),
      ).toBe(true)
      const createdBefore = bridge.created.length
      const sentBefore = bridge.channel.sent.length

      mounted.typeText('wake up')
      mounted.pressEnter()

      expect(
        await until({
          holds: async () => {
            const frame = await mounted.nextFrame()
            return frame.includes('wake up') && frame.includes('waking')
          },
          within: 20_000,
        }),
      ).toBe(true)

      mounted.typeText('and this too')
      mounted.pressEnter()
      expect(
        await until({
          holds: async () => (await mounted.nextFrame()).includes('and this too'),
          within: 20_000,
        }),
      ).toBe(true)
      expect(bridge.channel.sent.length).toBe(sentBefore)

      const wokenBefore = bridge.channel.woken.length
      releaseWake()
      expect(
        await until({
          holds: async () => bridge.channel.woken.length === wokenBefore + 1,
          within: 20_000,
        }),
      ).toBe(true)
      expect(bridge.channel.sent.length).toBe(sentBefore)

      bridge.channel.moveTo({ state: EConnectionView.Connected, detail: null })

      expect(
        await until({
          holds: async () => {
            const texts = bridge.channel.sent.flatMap((said) => [
              said.text,
              ...(said.context ?? []).flatMap((draft) =>
                draft.type === 'user-said' ? [draft.text] : [],
              ),
            ])
            return texts.includes('wake up') && texts.includes('and this too')
          },
          within: 20_000,
        }),
      ).toBe(true)
      expect(bridge.created.length).toBe(createdBefore + 1)
    } finally {
      releaseWake()
      await mounted.done()
    }
  }, 60_000)
})
