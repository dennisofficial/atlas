import { describe, expect, test } from 'bun:test'

import { frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice, ENoticeTone, notify } from '../../ui/notice-store'
import { openSession, WITHIN } from './app-next-harness'

const UPDATE_NOTICE = 'atlas update: v9.9.9 available (running v1.0.0)'

describe('the update check', () => {
  test('asks for the account home once the app is signed in, and shows the notice', async () => {
    dismissNotice()
    const asked: { home: string }[] = []

    const mounted = await openSession({
      checkUpdate: async (args) => {
        asked.push(args)
        notify({ tone: ENoticeTone.Info, sticky: true, text: UPDATE_NOTICE })
      },
    })

    try {
      expect(asked.length).toBeGreaterThan(0)
      for (const call of asked) expect(call.home).toBe(mounted.home)

      const frame = await frameWhen({
        setup: mounted.setup,
        holds: (text) => text.includes('v9.9.9 available'),
        within: WITHIN,
        describe: 'the update notice',
      })
      expect(frame).toContain('atlas update')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
