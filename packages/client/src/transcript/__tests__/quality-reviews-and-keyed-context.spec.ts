import {
  EQualityReviewStatus,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { durableEntries } from '../durable-entries'
import { toolRuns } from '../tool-runs'
import { EEntryKind, type SystemContextEntry } from '../transcript-model'

let seq = 0

const envelope = () => {
  seq += 1
  return {
    id: toEventId(`q${seq}`),
    seq,
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    depth: 0,
    at: '2026-11-23T00:00:00.000Z',
  }
}

const called = (n: number): Event =>
  ({
    ...envelope(),
    type: 'tool-called',
    callId: toCallId(`call-${n}`),
    name: 'write',
    input: {},
    ordinal: n,
  }) as Event

const resulted = (n: number): Event =>
  ({
    ...envelope(),
    type: 'tool-result',
    callId: toCallId(`call-${n}`),
    name: 'write',
    output: {},
  }) as Event

const reviewed = (n: number, path: string): Event =>
  ({
    ...envelope(),
    type: 'code-quality-reviewed',
    callId: toCallId(`call-${n}`),
    workspaceNamespace: 'repo',
    path,
    beforeHash: null,
    afterHash: 'h',
    status: EQualityReviewStatus.Completed,
    assessments: [],
    findings: [],
    durationMs: 4,
  }) as Event

const loaded = (args: { slot: string; key: string; content: string }): Event =>
  ({ ...envelope(), type: 'context-loaded', ...args }) as Event

const said = (text: string): Event => ({ ...envelope(), type: 'user-said', text })

describe('quality reviews a log holds as their own events', () => {
  it('shows both reviews of one call, in log order, when they arrive after the tool result', () => {
    const runs = toolRuns([
      called(1),
      resulted(1),
      reviewed(1, 'a.ts'),
      said('carry on'),
      reviewed(1, 'b.ts'),
    ])

    expect(runs[0]?.calls[0]?.qualityReviews?.map((review) => review.path)).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  it('keeps each call to its own reviews', () => {
    const runs = toolRuns([called(1), resulted(1), reviewed(1, 'a.ts'), called(2), resulted(2)])

    expect(runs[0]?.calls.map((call) => call.qualityReviews?.length)).toEqual([1, 0])
  })

  it('keeps a denied call with no reviews', () => {
    const runs = toolRuns([
      called(1),
      {
        ...envelope(),
        type: 'tool-denied',
        callId: toCallId('call-1'),
        name: 'write',
        reason: 'no',
      } as Event,
      reviewed(1, 'a.ts'),
    ])

    expect(runs[0]?.calls[0]?.qualityReviews).toEqual([])
  })
})

describe('a context event keyed to the call it followed', () => {
  const events = [
    called(1),
    resulted(1),
    loaded({ slot: 'review', key: 'call-1', content: 'finding A' }),
  ]

  it('becomes one attachment of that call', () => {
    const runs = toolRuns(events)

    expect(runs[0]?.calls[0]?.attachments).toEqual([
      { id: 'q3', slot: 'review', name: 'call-1', content: 'finding A' },
    ])
  })

  it('takes no system-context row of its own', () => {
    const contexts = durableEntries({ events }).filter(
      (entry): entry is SystemContextEntry => entry.kind === EEntryKind.SystemContext,
    )

    expect(contexts).toEqual([])
  })
})
