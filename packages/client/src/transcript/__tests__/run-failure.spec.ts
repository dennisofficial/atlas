import { describe, expect, it } from 'bun:test'
import { ERunFailureKind, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'

import { EStepEnd } from '../../channel'
import { deriveTranscript } from '../derive-transcript'
import { latestRunFailure } from '../run-failure'
import { ended, log, started, stepOne, textDelta } from './fixture'

const failure = { kind: ERunFailureKind.Quota, message: 'out of credit' }

const failedAt = (args: { seq: number; run: string }): Event => ({
  id: toEventId(`event-${args.seq}`),
  seq: args.seq,
  threadId: toThreadId('thread-fixture'),
  runId: toRunId(args.run),
  depth: 0,
  at: '2026-01-01T00:00:00.000Z',
  type: 'run-failed',
  failure,
})

const withFailure = (events: readonly Event[]): Event[] => [
  ...events,
  failedAt({ seq: events.length + 1, run: 'run-thrown' }),
]

describe('latestRunFailure', () => {
  it('survives with no live steps and carries the envelope run id', () => {
    const events = withFailure(log([{ type: 'user-said', text: 'hi' }]))
    const model = deriveTranscript({ events, signals: [] })

    expect(model.failure).toEqual({
      message: 'out of credit',
      failure,
      runId: toRunId('run-thrown'),
    })
  })

  it('counts a durable failure as non-empty and renders no entry', () => {
    const model = deriveTranscript({
      events: [failedAt({ seq: 1, run: 'run-a' })],
      signals: [],
    })

    expect(model.entries).toEqual([])
    expect(model.failure?.failure).toEqual(failure)
  })

  it('is superseded by a later user-said', () => {
    const [first, , third] = log([
      { type: 'user-said', text: 'hi' },
      { type: 'user-said', text: 'filler' },
      { type: 'user-said', text: 'again' },
    ])

    expect(
      latestRunFailure(
        [first, failedAt({ seq: 2, run: 'run-a' }), third].flatMap((e) => (e ? [e] : [])),
      ),
    ).toBeNull()
  })

  it('is superseded by a later assistant-said', () => {
    const [first, , third] = log([
      { type: 'user-said', text: 'hi' },
      { type: 'user-said', text: 'filler' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'ok' }] },
    ])

    expect(
      latestRunFailure(
        [first, failedAt({ seq: 2, run: 'run-a' }), third].flatMap((e) => (e ? [e] : [])),
      ),
    ).toBeNull()
  })

  it('is hidden by a running live step of a retry', () => {
    const events = [failedAt({ seq: 1, run: 'run-a' })]
    const signals = [started(stepOne), textDelta({ stepId: stepOne, blockId: 'b', text: 'hi' })]

    expect(deriveTranscript({ events, signals }).failure).toBeNull()
  })

  it('keeps the live message when no durable row has arrived', () => {
    const signals = [
      started(stepOne),
      ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
    ]

    expect(deriveTranscript({ events: [], signals }).failure).toEqual({
      message: null,
      failure: null,
      runId: null,
    })
  })

  it('prefers the durable failure over the live failed step', () => {
    const signals = [
      started(stepOne),
      ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
    ]
    const model = deriveTranscript({
      events: [failedAt({ seq: 1, run: 'run-a' })],
      signals,
    })

    expect(model.failure?.failure).toEqual(failure)
  })
})
