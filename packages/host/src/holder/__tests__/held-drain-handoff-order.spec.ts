import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '@dltech/atlas-agent'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { HeldDrain } from '../held-drain'
import type { HeldEnding } from '../held-ending'
import type { HeldSessionDeps } from '../held-session-deps'
import type { HeldTurns } from '../held-turns'

const drainFor = (order: string[], trace = new RecordingTracer()): HeldDrain =>
  new HeldDrain({
    deps: {
      sessionId: 'session-1',
      plane: { readInbox: async () => [] },
      timers: { now: () => 0 },
    } as unknown as HeldSessionDeps,
    sessionId: 'session-1',
    pause: new PauseSignal(),
    turns: {
      turnRunning: false,
    } as unknown as HeldTurns,
    ending: {
      handBack: async () => {
        order.push('ended')
      },
    } as unknown as HeldEnding,
    record: () => undefined,
    childrenPause: async () => {
      order.push('children-paused')
    },
    childrenRunning: () => 2,
    pendingHandoff: () => {
      order.push('settled-pending')
    },
    trace: () => trace,
  })

describe('a holder handing off', () => {
  it('pauses the sub-agents before it settles their in-flight calls', async () => {
    const order: string[] = []

    await drainFor(order).handoff()

    expect(order).toEqual(['children-paused', 'settled-pending', 'ended'])
  })

  it('records one holder.drain span with each wait of the hand-off', async () => {
    const trace = new RecordingTracer()

    await drainFor([], trace).handoff()

    const [span] = trace.named(ESpan.Drain)
    expect(span?.ended).toBe(true)
    expect(span?.fields.sessionId).toBe('session-1')
    expect(span?.fields.extra).toEqual({ turnRunning: false, children: 2, inFlightCapped: false })
    expect(span?.fields.timings).toEqual({ inFlight: 0, children: 0, recordTail: 0, handBack: 0 })
  })
})
