import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { BIRTH_CANCELLED_NOTICE } from '../cloud/cloud-birth-notices'
import { until } from './app-fixture'
import { bornThreadApp, holdingProvisioning, mountUnborn } from './born-thread-fixture'
import type { FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const countingLocalActivations = (app: FakeApp): { bound: number } => {
  const counted = { bound: 0 }
  const activate = app.sessionOwner.activateLocal
  app.sessionOwner.activateLocal = (given) => {
    if (given.binding !== undefined) counted.bound += 1
    return activate(given)
  }
  return counted
}

const noticeNaming = (text: string): Promise<boolean> =>
  until({ holds: async () => currentNotices().some((notice) => notice.text.includes(text)), within: 20_000 })

describe('a first-send birth that fails partway', () => {
  it('names the cause, keeps the draft, places nothing on the host, and retries on the next send', async () => {
    const app = bornThreadApp({})
    const bridge = fakeBridge({ createFails: new Error('the pod engine exploded') })
    const mounted = await mountUnborn({ app, bridge })

    try {
      const threadId = app.sessionOwner.snapshot().threadId!
      const activations = countingLocalActivations(app)

      await mounted.command('first words')

      expect(await noticeNaming('the pod engine exploded')).toBe(true)
      expect(await until({ holds: async () => mounted.draft() === 'first words', within: 20_000 })).toBe(true)
      expect(bridge.destroyed).toContain(threadId)
      expect(app.sessionOwner.placement.snapshot(threadId)?.revision ?? 0).toBe(0)
      expect(app.threads.chosenLocations).toEqual([])
      expect(activations.bound).toBe(0)
      expect(await app.log.read({ threadId })).toEqual([])
      mounted.dismiss()
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)

      await mounted.command('')

      expect(await until({ holds: async () => bridge.created.length === 2, within: 20_000 })).toBe(true)
      expect(bridge.created.map((born) => born.threadId)).toEqual([threadId, threadId])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('says the start was cancelled, keeps the draft, and destroys the pod when the overlay is cancelled', async () => {
    const app = bornThreadApp({})
    const bridge = fakeBridge()
    const held = holdingProvisioning(bridge)
    const mounted = await mountUnborn({ app, bridge })

    try {
      const threadId = app.sessionOwner.snapshot().threadId!
      await mounted.command('cancel me')
      expect(await mounted.frameHolds((frame) => frame.includes('STARTING A POD'))).toBe(true)

      mounted.dismiss()

      expect(await noticeNaming(BIRTH_CANCELLED_NOTICE)).toBe(true)
      expect(await until({ holds: async () => mounted.draft() === 'cancel me', within: 20_000 })).toBe(true)
      expect(bridge.destroyed).toContain(threadId)
      expect(app.threads.chosenLocations).toEqual([])
      expect(await mounted.frameHolds((frame) => !frame.includes('STARTING A POD') && frame.includes('pod ▾'))).toBe(true)
    } finally {
      held.release()
      await mounted.done()
    }
  }, 60_000)
})
