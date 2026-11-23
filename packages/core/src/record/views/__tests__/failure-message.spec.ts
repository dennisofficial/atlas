import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../../events/ids'
import { chainEvents } from '../../chain-events'
import type { V2Body, V2Event } from '../../event'
import {
  failureMessageOf,
  initialFailureMessage,
  messageAfterFailureOf,
  stepFailureMessage,
  type FailureMessageState,
} from '../failure-message'
import { initialSessionViewState, rebuildEditSensitive, stepSessionView } from '../session-view'

const NOW = '2026-11-03T12:00:00.000Z'

const events = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId: toThreadId('t'), runId: toRunId('r'), epoch: 1, at: NOW, bodies })

const started = (inboxHead: number): V2Body => ({
  type: 'session-start-failed',
  reason: 'no sandbox',
  inboxHead,
  permanent: false,
})

const posted = (inboxId: number): V2Body => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: NOW,
})

const said = (text: string): V2Body => ({ type: 'user-said', text })

const prepared: V2Body = { type: 'workspace-prepared' }

const folded = (bodies: readonly V2Body[]): FailureMessageState =>
  events(bodies).reduce(stepSessionView, initialSessionViewState).failure

const afterFailure = (bodies: readonly V2Body[]): boolean => messageAfterFailureOf(folded(bodies))

describe('failure message in the session view', () => {
  it('folds the same state the view fold carries', () => {
    const sequences: V2Body[][] = [
      [prepared, posted(1), started(1)],
      [prepared, posted(1), started(1), posted(2)],
      [prepared, posted(1), started(1), posted(2), said('hi')],
      [started(0), posted(1)],
      [posted(1), started(2)],
      [prepared, posted(1), started(1), posted(2), prepared],
    ]
    for (const bodies of sequences) {
      const list = events(bodies)
      expect(folded(bodies)).toEqual(failureMessageOf(list))
      expect(list.reduce(stepFailureMessage, initialFailureMessage)).toEqual(folded(bodies))
    }
  })

  it('reports a message only once it is posted after the failure head', () => {
    expect(afterFailure([prepared, posted(1), started(1)])).toBe(false)
    expect(afterFailure([prepared, posted(1), started(1), posted(2)])).toBe(true)
    expect(afterFailure([started(0)])).toBe(false)
    expect(afterFailure([started(0), posted(1)])).toBe(true)
    expect(afterFailure([posted(1), started(2)])).toBe(false)
    expect(afterFailure([posted(2), started(1)])).toBe(false)
  })

  it('clears the pending message on the next user turn', () => {
    const bodies: V2Body[] = [prepared, posted(1), started(1), posted(2)]
    expect(afterFailure(bodies)).toBe(true)
    expect(afterFailure([...bodies, said('retry')])).toBe(false)
  })

  it('recomputes from the visible tail when edits are replayed', () => {
    const list = events([prepared, posted(1), started(1), posted(2)])
    const state = list.reduce(stepSessionView, initialSessionViewState)
    expect(messageAfterFailureOf(state.failure)).toBe(true)
    const rebuilt = rebuildEditSensitive({
      state,
      visibleTail: list.slice(0, 3),
      foldableTail: list.slice(0, 3),
    })
    expect(rebuilt.failure).toEqual(failureMessageOf(list.slice(0, 3)))
    expect(messageAfterFailureOf(rebuilt.failure)).toBe(false)
  })
})
