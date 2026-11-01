import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { until } from './app-fixture'
import { bornThreadApp, holdingProvisioning, mountUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

describe('the inline boot block on a first send', () => {
  it('shows the message and a live block in the transcript while the composer stays usable', async () => {
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app: bornThreadApp({}), bridge })

    try {
      await mounted.command('wake the pod')

      const shown = await mounted.frameHolds(
        (frame) => frame.includes('Starting the pod') && frame.includes('wake the pod'),
      )
      expect(shown).toBe(true)
      expect(await mounted.frame()).not.toContain('STARTING A POD')
      expect(bridge.created.length).toBe(0)

      await mounted.input.typeText('typed during boot')
      await mounted.frame()
      expect(mounted.draft()).toBe('typed during boot')

      held.release()
      expect(await until({ holds: async () => bridge.created.length === 1, within: 20_000 })).toBe(
        true,
      )
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)

  it('queues a second send in order and shows both while booting', async () => {
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app: bornThreadApp({}), bridge })

    try {
      await mounted.command('first words')
      await mounted.command('second words')

      const frame = await mounted.frameHolds(
        (shown) => shown.includes('first words') && shown.includes('second words'),
      )
      expect(frame).toBe(true)
      expect(mounted.draft()).toBe('')
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)

  it('delivers queued sends in order once the pod attaches', async () => {
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app: bornThreadApp({}), bridge })

    try {
      await mounted.command('first words')
      await mounted.command('second words')
      held.release()

      const arrived = await until({
        holds: async () => bridge.created.length > 0 && bridge.channel.sent.length >= 2,
        within: 20_000,
      })
      expect(arrived).toBe(true)
      /**
       * A first send has no pod session yet, so the API lane is not composed in — the birth
       * keeps the local queue and the channel carries both sends in order once the pod attaches.
       */
      expect(bridge.sentMessages).toEqual([])
      expect(bridge.channel.sent.map((said) => said.text).slice(0, 2)).toEqual([
        'first words',
        'second words',
      ])
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)

  it('shows a failure in the block and restores the draft', async () => {
    const bridge = fakeBridge({ createFails: new Error('the pod engine exploded') })
    const mounted = await mountUnborn({ app: bornThreadApp({}), bridge })

    try {
      await mounted.command('first words')

      expect(await mounted.frameHolds((frame) => frame.includes('the pod engine exploded'))).toBe(
        true,
      )
      expect(
        await until({ holds: async () => mounted.draft() === 'first words', within: 20_000 }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
