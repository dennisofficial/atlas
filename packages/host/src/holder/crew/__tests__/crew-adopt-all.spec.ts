import { describe, expect, it } from 'bun:test'

import { SequentialIds } from '@dltech/atlas-agent/testing'
import { toThreadId } from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../../held-session-deps'
import type { SessionRuntime } from '../../ports'
import { RecordBookkeeping } from '../../record/record-bookkeeping'
import type { SessionRecord } from '../../record/record-adapter'
import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import { CrewRoom } from '../crew-room'
import type { OpenChild } from '../open-children'

const PARENT = toThreadId('thread-parent')
const FIRST = toThreadId('thread-adopt-all-1')
const SECOND = toThreadId('thread-adopt-all-2')
const AT = '2026-01-01T00:00:00.000Z'

const childOf = (agentId: typeof FIRST): OpenChild => ({
  agentId,
  agentType: 'builder',
  intent: 'build it',
  group: undefined,
  spawnedAt: AT,
  worktree: undefined,
})

const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const crewOf = (args: {
  readEvents: (threadId: string) => Promise<unknown>
  post: (payload: string) => Promise<void>
}): CrewRoom =>
  new CrewRoom({
    deps: {
      sessionId: 'session-1',
      ids: new SequentialIds(),
      timers: { now: () => 0 },
      plane: {
        post: async (message: { payload: string }) => args.post(message.payload),
        readInbox: async () => [],
        readEvents: async (params: { threadId: string }) => args.readEvents(params.threadId),
      },
    } as unknown as HeldSessionDeps,
    runtime: {
      choiceFor: () => RIG_MODEL_CHOICE,
      modelChoice: RIG_MODEL_CHOICE,
    } as unknown as SessionRuntime,
    parentRecord: {
      eventCache: () => ({ eventsAfter: () => [], bookkeeping: () => new RecordBookkeeping() }),
    } as unknown as SessionRecord,
    parentThreadId: PARENT,
    epoch: 1,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })

describe('adopting every open child at once', () => {
  it('waits for a blocked child to settle before it rejects with the first failure', async () => {
    const gate = Promise.withResolvers<void>()
    const started: string[] = []
    const crew = crewOf({
      readEvents: async (threadId) => {
        started.push(threadId)
        if (threadId === SECOND) throw new Error('thread gone')
        await gate.promise
        return { events: [] }
      },
      post: async (payload) => {
        if (payload.includes(FIRST)) {
          await gate.promise
          throw new Error('posting the first ending failed')
        }
        throw new Error('posting the second ending failed')
      },
    })

    const adopting = crew.adoptAll([childOf(FIRST), childOf(SECOND)])
    let settled = false
    void adopting.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await flush()

    expect(started).toContain(FIRST)
    expect(started).toContain(SECOND)
    expect(settled).toBe(false)

    gate.resolve()

    await expect(adopting).rejects.toThrow('posting the first ending failed')
    expect(crew.list()).toEqual([])
  })
})
