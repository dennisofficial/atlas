import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '../../events/body'
import { toCallId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import type { V2Body } from '../event'
import { visibleLoopEvents } from '../loop-events'
import {
  SUMMARY_REFUSAL_ALREADY,
  SUMMARY_REFUSAL_CANNOT,
  SUMMARY_REFUSAL_NOTHING,
  SUMMARY_REFUSAL_SPLITS_TOOL,
  summaryPointsOf,
  summaryTargetOf,
} from '../summary-target'
import { NOW, runId, threadId } from './support'

const said = (text: string): V2Body => ({ type: 'user-said', text })
const replied = (text: string): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const called: V2Body = {
  type: 'tool-called',
  callId: toCallId('c1'),
  name: 'bash',
  input: {},
  ordinal: 0,
}
const answered: V2Body = { type: 'tool-result', callId: toCallId('c1'), name: 'bash', output: 'x' }

const visibleOf = (bodies: readonly V2Body[]) =>
  visibleLoopEvents(chainEvents({ threadId, runId, epoch: 1, at: NOW, from: undefined, bodies }))

describe('summaryTargetOf', () => {
  const conversation = visibleOf([said('a'), replied('b'), said('c'), replied('d'), said('e')])

  it('allows a range ending before a message and starts at the first visible event', () => {
    expect(summaryTargetOf({ events: conversation, throughSeq: 2 })).toEqual({
      ok: true,
      fromSeq: 1,
      throughSeq: 2,
    })
    expect(summaryTargetOf({ events: conversation, throughSeq: 4 })).toEqual({
      ok: true,
      fromSeq: 1,
      throughSeq: 4,
    })
  })

  it('refuses a seq that does not sit right before a message', () => {
    for (const throughSeq of [1, 3, 5, 99]) {
      expect(summaryTargetOf({ events: conversation, throughSeq })).toEqual({
        ok: false,
        reason: SUMMARY_REFUSAL_CANNOT,
      })
    }
  })

  it('refuses an empty range', () => {
    expect(summaryTargetOf({ events: conversation, throughSeq: 0 })).toEqual({
      ok: false,
      reason: SUMMARY_REFUSAL_NOTHING,
    })
  })

  it('refuses a range that only holds what a summary already covers', () => {
    const summarised: V2Body = {
      type: 'history-summarised',
      fromSeq: 1,
      throughSeq: 4,
      anchor: ECompactionAnchor.Prefix,
      summary: 's',
    }
    const events = visibleOf([
      said('a'),
      { type: 'permission-revoked', grantId: 'g' },
      said('b'),
      replied('c'),
      summarised,
      said('d'),
    ])
    expect(events.map((event) => event.seq)).toEqual([2, 5, 6])
    expect(summaryTargetOf({ events, throughSeq: 5 })).toEqual({
      ok: false,
      reason: SUMMARY_REFUSAL_ALREADY,
    })
  })

  it('folds an earlier summary into the next one', () => {
    const summarised: V2Body = {
      type: 'history-summarised',
      fromSeq: 1,
      throughSeq: 2,
      anchor: ECompactionAnchor.Prefix,
      summary: 's',
    }
    const events = visibleOf([
      said('a'),
      replied('b'),
      summarised,
      said('c'),
      replied('d'),
      said('e'),
    ])
    expect(summaryTargetOf({ events, throughSeq: 5 })).toEqual({
      ok: true,
      fromSeq: 3,
      throughSeq: 5,
    })
  })

  it('refuses a range that splits a tool call', () => {
    const events = visibleOf([said('a'), called, said('b'), answered, said('c')])
    expect(summaryTargetOf({ events, throughSeq: 2 })).toEqual({
      ok: false,
      reason: SUMMARY_REFUSAL_SPLITS_TOOL,
    })
    expect(summaryTargetOf({ events, throughSeq: 4 })).toMatchObject({ ok: true })
  })
})

describe('summaryPointsOf', () => {
  it('offers every message but the first, reaching the event before it', () => {
    const events = visibleOf([said('a'), replied('b'), said('c'), said('d')])
    const points = summaryPointsOf(events)
    expect([...points.values()]).toEqual([
      { throughSeq: 2, messages: 1 },
      { throughSeq: 3, messages: 2 },
    ])
  })
})
