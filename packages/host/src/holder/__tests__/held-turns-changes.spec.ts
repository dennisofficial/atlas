import { ETurnStatus, type LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'
import { toCallId, toEventId, toRunId, toThreadId, type IdPort } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { HeldSessionDeps } from '../held-session-deps'
import { HeldTurns } from '../held-turns'

const ids: IdPort = {
  nextThreadId: () => toThreadId('thread-next'),
  nextRunId: () => toRunId('run-next'),
  nextEventId: () => toEventId('event-next'),
  nextCallId: () => toCallId('call-next'),
} as IdPort

const runner = {
  runTurn: () => Promise.resolve({ status: ETurnStatus.Completed }),
  resume: () => Promise.resolve({ status: ETurnStatus.Completed }),
} as unknown as LoopTurnRunner

describe('HeldTurns turn end', () => {
  it('asks for a snapshot at turn end and resolves the turn without waiting for it', async () => {
    const turns = new HeldTurns({ ids } as HeldSessionDeps)
    let asked = 0
    const hung = { snapshotNow: () => new Promise<void>(() => undefined) }
    turns.onTurnEnd = () => {
      asked += 1
      void hung.snapshotNow()
    }

    await turns.drive({
      runner,
      record: {
        threadId: toThreadId('thread-changes'),
        append: () => Promise.resolve([]),
        eventCache: () => ({
          eventsAfter: () => [],
          currentHead: () => ({ seq: 0 }),
          queuedSince: () => null,
        }),
      },
      threadId: toThreadId('thread-changes'),
      pause: new PauseSignal(),
      resume: false,
    })

    expect(asked).toBe(1)
    expect(turns.turnRunning).toBe(false)
  })
})
