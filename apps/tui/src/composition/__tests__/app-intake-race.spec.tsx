import { describe, expect, it } from 'bun:test'

import type { Chunk, ModelPort, ModelStepResult } from '@dltech/atlas-core'
import { EFinishReason, toThreadId } from '@dltech/atlas-core'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { open, promiseGate, until, type Mounted } from './app-fixture'
import { fakeApp, type FakeApp } from './fake-app'

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

const countingModelPort = (args: { reply: string; onStep?: (() => Promise<void> | void) | undefined }): { port: ModelPort; calls: () => number } => {
  let calls = 0
  return {
    calls: () => calls,
    port: {
      identity: { id: 'counting', modelId: 'counting' },
      async step({ onChunk }): Promise<ModelStepResult> {
        calls += 1
        await args.onStep?.()
        onChunk?.({ type: 'text-start', id: 'block' } satisfies Chunk)
        return {
          parts: [{ type: 'text', text: args.reply }],
          toolCalls: [],
          finishReason: EFinishReason.Stop,
        }
      },
    },
  }
}

describe('a fresh idle send over the shared intake', () => {
  it('starts exactly one model call and keeps workspace metadata and the title intact', async () => {
    const started = promiseGate()
    const counted = countingModelPort({ reply: 'all green', onStep: () => started.release() })
    const app = fakeApp({ model: counted.port, intake: true, names: 'the fresh thread' })
    const mounted = await openFresh(app)

    try {
      mounted.typeText('what is in here?')
      mounted.pressEnter()

      const answered = await until({
        holds: async () => (await mounted.frame()).includes('all green'),
        within: WAIT_MS,
      })
      expect(answered).toBe(true)

      expect(counted.calls()).toBe(1)

      const active = mounted.app.activeThread()?.threadId
      if (active === undefined) throw new Error('no active thread')
      const thread = await app.threads.find({ threadId: toThreadId(active) })
      expect(thread).toBeDefined()
      expect(thread?.workspace).toBe(app.workspace.workspace)

      const titled = await until({ holds: async () => app.titled.length > 0, within: WAIT_MS })
      expect(titled).toBe(true)
      expect(app.titled[0]).toBe('Operator: what is in here?')
    } finally {
      await mounted.done()
    }
  })

  it('runs no concurrent model call across rapid sends', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const port: ModelPort = {
      identity: { id: 'serialized', modelId: 'serialized' },
      async step({ onChunk }): Promise<ModelStepResult> {
        calls += 1
        active += 1
        peak = Math.max(peak, active)
        onChunk?.({ type: 'text-start', id: 'block' } satisfies Chunk)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return { parts: [{ type: 'text', text: 'green' }], toolCalls: [], finishReason: EFinishReason.Stop }
      },
    }
    const app = fakeApp({ model: port, intake: true })
    const mounted = await openFresh(app)

    try {
      mounted.typeText('first rapid')
      mounted.pressEnter()
      mounted.typeText('second rapid')
      mounted.pressEnter()
      mounted.typeText('third rapid')
      mounted.pressEnter()

      const answered = await until({
        holds: async () => {
          const activeId = mounted.app.activeThread()?.threadId
          if (activeId === undefined) return false
          const queued = app.pending.forThread({ threadId: toThreadId(activeId) }).getSnapshot()
          return calls > 0 && active === 0 && queued.length === 0
        },
        within: WAIT_MS,
      })
      expect(answered).toBe(true)
      expect(peak).toBe(1)
      expect(calls).toBe(1)
    } finally {
      await mounted.done()
    }
  })
})
