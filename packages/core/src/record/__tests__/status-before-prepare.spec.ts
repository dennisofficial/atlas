import { describe, expect, it } from 'bun:test'

import { toCallId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import type { RecordEventBody } from '../event'
import { ESessionStatus, sessionStatusOf } from '../session-status'
import { ETurnCause } from '../turns'
import { NOW, runId, threadId } from './support'

const CALL = toCallId('call-1')

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const statusOf = (events: readonly ReturnType<typeof log>[number][]) =>
  sessionStatusOf({ events, live: true, queuedSince: null, messageAfterFailure: false, now: NOW })

describe('status before the workspace has prepared', () => {
  it('reports preparing while no turn runs', () => {
    expect(statusOf([])).toEqual({ state: ESessionStatus.Preparing })
  })

  it('reports the running turn, not preparing, once the turn starts first', () => {
    const events = log([
      { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
      { type: 'tool-dispatched', callId: CALL, name: 'bash' },
    ])
    expect(statusOf(events)).toEqual({
      state: ESessionStatus.RunningTool,
      reason: 'bash',
      since: NOW,
    })
  })

  it('reports thinking once the turn starts first and no tool has run', () => {
    const events = log([{ type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }])
    expect(statusOf(events)).toEqual({ state: ESessionStatus.Thinking, since: NOW })
  })
})
