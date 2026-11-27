import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '@dltech/atlas-agent'

import { HeldDrain } from '../held-drain'
import type { HeldEnding } from '../held-ending'
import type { HeldSessionDeps } from '../held-session-deps'
import type { HeldTurns } from '../held-turns'

const realTimers = {
  now: () => Number(process.hrtime.bigint() / 1_000_000n),
  setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
  clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  random: () => 0.5,
}

const drainOf = (args: { pause: PauseSignal; handedBack: string[] }): HeldDrain =>
  new HeldDrain({
    deps: {
      sessionId: 'session-1',
      plane: { readInboxEntry: async () => undefined },
      timers: realTimers,
      drainCapMs: 60_000,
    } as unknown as HeldSessionDeps,
    sessionId: 'session-1',
    pause: args.pause,
    turns: { turnRunning: true } as unknown as HeldTurns,
    ending: {
      handBack: async () => {
        args.handedBack.push('ended')
      },
    } as unknown as HeldEnding,
    record: () => undefined,
    childrenPause: () => undefined,
    childrenRunning: () => 0,
    pendingHandoff: () => undefined,
    trace: () => undefined,
  })

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a holder draining the step it streamed', () => {
  it('waits for that step to be recorded before it hands the lease back', async () => {
    const pause = new PauseSignal()
    const handedBack: string[] = []
    const release = pause.beginStepSettle()

    const draining = drainOf({ pause, handedBack }).handoff()
    await flush()
    expect(handedBack).toEqual([])

    release()
    await draining
    expect(handedBack).toEqual(['ended'])
  }, 10_000)

  it('hands back at once when only a tool the step dispatched still runs', async () => {
    const pause = new PauseSignal()
    const handedBack: string[] = []

    await drainOf({ pause, handedBack }).handoff()

    expect(handedBack).toEqual(['ended'])
  }, 10_000)
})
