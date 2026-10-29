import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { BIRTH_CANCELLED_NOTICE } from '../cloud/cloud-birth-notices'
import { promiseGate, until } from './app-fixture'
import { bornThreadApp, holdingProvisioning, mountUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

const noticeNaming = (text: string): Promise<boolean> =>
  until({
    holds: async () => currentNotices().some((notice) => notice.text.includes(text)),
    within: 20_000,
  })

describe('a first-send birth that fails partway', () => {
  it('names the cause, keeps the draft, places nothing on the host, and retries on the next send', async () => {
    const app = bornThreadApp({})
    const bridge = fakeBridge({ createFails: new Error('the pod engine exploded') })
    const mounted = await mountUnborn({ app, bridge })

    try {
      const threadId = app.sessionOwner.snapshot().threadId!

      await mounted.command('first words')

      expect(await noticeNaming('the pod engine exploded')).toBe(true)
      expect(
        await until({ holds: async () => mounted.draft() === 'first words', within: 20_000 }),
      ).toBe(true)
      expect(bridge.destroyed).toContain(threadId)
      expect(app.sessionOwner.placement.snapshot(threadId)?.revision ?? 0).toBe(0)
      expect(app.threads.chosenLocations).toEqual([])
      expect(await app.log.read({ threadId })).toEqual([])
      mounted.dismiss()
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)

      await mounted.command('')

      expect(await until({ holds: async () => bridge.created.length === 2, within: 20_000 })).toBe(
        true,
      )
      expect(bridge.created.map((born) => born.threadId)).toEqual([threadId, threadId])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the attempt reserved until the cancelled provisioning settles, then destroys the pod and births again', async () => {
    const app = bornThreadApp({})
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app, bridge })

    try {
      const threadId = app.sessionOwner.snapshot().threadId!
      await mounted.command('cancel me')
      expect(await mounted.frameHolds((frame) => frame.includes('Starting the pod'))).toBe(true)

      mounted.dismiss()

      expect(await noticeNaming(BIRTH_CANCELLED_NOTICE)).toBe(true)
      expect(
        await until({ holds: async () => mounted.draft() === 'cancel me', within: 20_000 }),
      ).toBe(true)
      expect(bridge.destroyed).toEqual([])
      expect(app.threads.chosenLocations).toEqual([])

      await mounted.command('')

      expect(
        await until({ holds: async () => mounted.draft() === 'cancel me', within: 20_000 }),
      ).toBe(true)
      expect(bridge.created).toEqual([])

      held.release()

      expect(
        await until({ holds: async () => bridge.destroyed.includes(threadId), within: 20_000 }),
      ).toBe(true)
      expect(bridge.trail.indexOf('destroy')).toBeGreaterThan(bridge.trail.indexOf('sandbox'))
      expect(bridge.created.map((born) => born.threadId)).toEqual([threadId])
      expect(
        await mounted.frameHolds(
          (frame) => !frame.includes('Starting the pod') && frame.includes('pod ▾'),
        ),
      ).toBe(true)

      await mounted.command('')

      expect(await until({ holds: async () => bridge.created.length === 2, within: 20_000 })).toBe(
        true,
      )
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)
})

describe('a first send whose preflight has not answered yet', () => {
  it('births nothing new on /new, and the first thread keeps its attempt', async () => {
    const gate = promiseGate()
    const app = bornThreadApp({})
    const mounted = await mountUnborn({ app, preflight: { refusal: null, gate: gate.gate } })

    try {
      const threadId = app.sessionOwner.snapshot().threadId!
      await mounted.command('first words')
      await mounted.command('/new')

      expect(app.sessionOwner.snapshot().threadId).toBe(threadId)
      gate.release()

      expect(
        await until({
          holds: async () =>
            mounted.bridge.created.length > 0 &&
            mounted.bridge.channel.sent.some((said) => said.text === 'first words'),
          within: 20_000,
        }),
      ).toBe(true)
      expect(mounted.bridge.created.map((born) => born.threadId)).toEqual([threadId])
    } finally {
      gate.release()
      await mounted.done()
    }
  }, 60_000)

  it('keeps both the refused submission and what was typed meanwhile', async () => {
    const gate = promiseGate()
    const app = bornThreadApp({})
    const preflight = { refusal: 'Docker is not answering' as string | null, gate: gate.gate }
    const mounted = await mountUnborn({ app, preflight })

    try {
      await mounted.command('message A')
      await mounted.command('message B')
      gate.release()

      expect(
        await until({
          holds: async () => mounted.draft() === 'message A\n\nmessage B',
          within: 20_000,
        }),
      ).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      gate.release()
      await mounted.done()
    }
  }, 60_000)
})
