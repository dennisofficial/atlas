import { ETurnStatus, type LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'
import { toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { HeldSessionDeps } from '../held-session-deps'
import { HeldTurns } from '../held-turns'

const runner = {
  runTurn: () => Promise.resolve({ status: ETurnStatus.Completed }),
  resume: () => Promise.resolve({ status: ETurnStatus.Completed }),
} as unknown as LoopTurnRunner

describe('HeldTurns turn end', () => {
  it('asks for a snapshot at turn end and resolves the turn without waiting for it', async () => {
    const turns = new HeldTurns({} as HeldSessionDeps)
    let asked = 0
    const hung = { snapshotNow: () => new Promise<void>(() => undefined) }
    turns.onTurnEnd = () => {
      asked += 1
      void hung.snapshotNow()
    }

    await turns.drive({
      runner,
      threadId: toThreadId('thread-changes'),
      pause: new PauseSignal(),
      resume: false,
    })

    expect(asked).toBe(1)
    expect(turns.turnRunning).toBe(false)
  })
})
