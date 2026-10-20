import { describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { open, spokenIn, until, THREAD, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

const WITHIN_MS = 20_000

const script = { thinking: THINKING, reply: REPLY }

const naming = () =>
  fakeApp({ model: scriptedModelPort({ script }), names: 'Refresh-token rotation' })

describe('the resume journal', () => {
  it('records the thread id at open', async () => {
    const app = naming()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await until({
        holds: async () => mounted.app.journaled.length > 0,
        within: WITHIN_MS,
      })
      expect(mounted.app.journaled[0]?.handle).toBe(THREAD)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('records the new handle on /rename', async () => {
    const mounted = await open({ app: naming() })

    try {
      await mounted.typeText('/rename Doing something cool')
      mounted.pressEnter()

      const recorded = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.journaled.some((entry) => entry.handle === 'doing-something-cool')
        },
        within: WITHIN_MS,
      })

      expect(recorded).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('writes nothing while a thread has nothing said in it yet', async () => {
    const mounted = await open({
      app: naming(),
      opened: { threadId: THREAD, events: [], turns: [], name: null, started: false },
    })

    try {
      await mounted.frame()
      expect(mounted.app.journaled).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
