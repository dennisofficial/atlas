import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { open, until, type Mounted } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const WAIT_MS = 4_000

const openFresh = async (app: FakeApp): Promise<Mounted> =>
  open({
    app,
    opened: {
      threadId: app.ids.nextThreadId(),
      events: [],
      turns: [],
      name: null,
      started: false,
    },
  })

describe('an idle local send over the shared intake', () => {
  it('opens the thread with its workspace metadata and schedules the title', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'reading it', reply: 'all green' } }),
      intake: true,
      names: 'the fresh thread',
    })
    const mounted = await openFresh(app)

    try {
      mounted.typeText('what is in here?')
      mounted.pressEnter()

      const answered = await until({
        holds: async () => (await mounted.frame()).includes('all green'),
        within: WAIT_MS,
      })
      expect(answered).toBe(true)

      const active = mounted.app.activeThread()?.threadId
      if (active === undefined) throw new Error('no active thread')
      const thread = await app.threads.find({ threadId: toThreadId(active) })
      expect(thread).toBeDefined()
      expect(thread?.workspace).toBe(app.workspace.workspace)

      const titled = await until({
        holds: async () => app.titled.length > 0,
        within: WAIT_MS,
      })
      expect(titled).toBe(true)
      expect(app.titled[0]).toBe('Operator: what is in here?')
    } finally {
      await mounted.done()
    }
  })

  it('keeps a queued message queued when the commit fails, and sends it on retry', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'reading it', reply: 'all green' } }),
      intake: true,
    })
    const mounted = await openFresh(app)

    try {
      const active = mounted.app.activeThread()?.threadId
      if (active === undefined) throw new Error('no active thread')
      const threadId = toThreadId(active)

      mounted.typeText('first words')
      mounted.pressEnter()

      const answered = await until({
        holds: async () => (await mounted.frame()).includes('all green'),
        within: WAIT_MS,
      })
      expect(answered).toBe(true)

      const events = await app.log.read({ threadId })
      expect(events.map((event) => (event.type === 'user-said' ? event.text : event.type))).toContain(
        'first words',
      )
      expect(app.pending.forThread({ threadId }).getSnapshot()).toHaveLength(0)
    } finally {
      await mounted.done()
    }
  })
})
