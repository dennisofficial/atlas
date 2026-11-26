import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '@dltech/atlas-agent'

import { HeldDrain } from '../held-drain'
import type { HeldEnding } from '../held-ending'
import type { HeldSessionDeps } from '../held-session-deps'
import type { HeldTurns } from '../held-turns'

const drainFor = (order: string[]): HeldDrain =>
  new HeldDrain({
    deps: {
      sessionId: 'session-1',
      plane: { readInbox: async () => [] },
    } as unknown as HeldSessionDeps,
    sessionId: 'session-1',
    pause: new PauseSignal(),
    turns: {
      turnRunning: false,
      whenIdle: async () => undefined,
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
    pendingHandoff: () => {
      order.push('settled-pending')
    },
  })

describe('a holder handing off', () => {
  it('pauses the sub-agents before it settles their in-flight calls', async () => {
    const order: string[] = []

    await drainFor(order).handoff()

    expect(order).toEqual(['children-paused', 'settled-pending', 'ended'])
  })
})
