import { ECompactionAnchor, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { ETurnStatus } from '../../channel'
import type { TurnSpend } from '../turn-spend'
import { describe, expect, it } from 'bun:test'

import { durableEntries } from '../durable-entries'
import { EAuthor, EEntryKind, type TranscriptEntry } from '../transcript-model'
import { settledAtOf, turnsBySeq } from '../turn-rows'

const THREAD = toThreadId('thread-1')

const ASKED = toRunId('run-asked')

const ANSWERED = toRunId('run-answered')

const event = (over: Partial<Event> & Pick<Event, 'type'>): Event =>
  ({
    id: `event-${String(over.seq ?? 1)}`,
    seq: 1,
    threadId: THREAD,
    runId: ANSWERED,
    depth: 0,
    at: '2026-08-28T18:32:00.000Z',
    ...over,
  }) as Event

const spend = (over: Partial<TurnSpend> = {}): TurnSpend => ({
  runId: ANSWERED,
  threadId: THREAD,
  status: ETurnStatus.Completed,
  providerId: 'anthropic',
  modelId: 'claude-sonnet-5',
  steps: 1,
  inputTokens: 400,
  outputTokens: 1_100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '2026-08-28T18:31:06.000Z',
  endedAt: '2026-08-28T18:32:00.000Z',
  durationMs: 54_000,
  ...over,
})

const exchange: readonly Event[] = [
  event({ type: 'user-said', text: 'go', seq: 1, runId: ASKED }),
  event({ type: 'assistant-said', parts: [{ type: 'text', text: 'done' }], seq: 2 }),
]

describe('where a finished turn is drawn', () => {
  it('sits on the last event of the run it measured', () => {
    const bySeq = turnsBySeq({ events: exchange, turns: [spend()] })

    expect([...bySeq.keys()]).toEqual([2])
  })

  it('is left out when the rows it described were rewound away', () => {
    const bySeq = turnsBySeq({ events: exchange, turns: [spend({ runId: toRunId('run-gone') })] })

    expect(bySeq.size).toBe(0)
  })

  it('is left out for a turn that failed, because the failure carries its own cost', () => {
    const bySeq = turnsBySeq({ events: exchange, turns: [spend({ status: ETurnStatus.Failed })] })

    expect(bySeq.size).toBe(0)
  })

  it('is kept for a turn the operator stopped', () => {
    const bySeq = turnsBySeq({
      events: exchange,
      turns: [spend({ status: ETurnStatus.Interrupted })],
    })

    expect(bySeq.size).toBe(1)
  })
})

describe('a finished turn in the transcript', () => {
  it('stays gone when a summary replaced its rows and only spared bookkeeping survived', () => {
    const events: readonly Event[] = [
      event({
        type: 'context-loaded',
        slot: 'file',
        key: 'CLAUDE.md',
        content: 'guidance',
        seq: 1,
      }),
      event({
        type: 'history-compacted',
        anchor: ECompactionAnchor.Prefix,
        fromSeq: 1,
        throughSeq: 2,
        summary: 'the opening',
        replaced: 1,
        seq: 2,
        runId: toRunId('run-stand-in'),
      }),
      event({ type: 'user-said', text: 'next', seq: 3, runId: toRunId('run-asked-2') }),
    ]

    const entries = durableEntries({ events, turns: [spend()] })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.SystemContext,
      EEntryKind.HistoryCompacted,
      EEntryKind.OperatorSaid,
    ])
  })

  it('lands after the reply rather than before it', () => {
    const entries = durableEntries({ events: exchange, turns: [spend()] })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
      EEntryKind.TurnEnded,
    ])
  })

  it('carries what the turn cost and when it ended', () => {
    const entries = durableEntries({ events: exchange, turns: [spend()] })
    const ended = entries.at(-1)

    expect(ended?.kind).toBe(EEntryKind.TurnEnded)
    expect(ended).toMatchObject({
      durationMs: 54_000,
      outputTokens: 1_100,
      endedAt: '2026-08-28T18:32:00.000Z',
      interrupted: false,
    })
  })

  it('stays put when a later turn arrives, so history does not move', () => {
    const later: readonly Event[] = [
      ...exchange,
      event({ type: 'user-said', text: 'again', seq: 3, runId: toRunId('run-asked-2') }),
      event({
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'sure' }],
        seq: 4,
        runId: toRunId('run-answered-2'),
      }),
    ]

    const entries = durableEntries({
      events: later,
      turns: [spend(), spend({ runId: toRunId('run-answered-2'), durationMs: 1_000 })],
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
      EEntryKind.TurnEnded,
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
      EEntryKind.TurnEnded,
    ])
  })

  it('keeps two operator messages apart when a turn ended between them', () => {
    const events: readonly Event[] = [
      event({ type: 'user-said', text: 'one', seq: 1, runId: ASKED }),
      event({ type: 'user-said', text: 'two', seq: 2, runId: ANSWERED }),
    ]

    const folded = durableEntries({ events, turns: [] })
    const parted = durableEntries({ events, turns: [spend()] })

    expect(folded.map((entry) => entry.kind)).toEqual([EEntryKind.OperatorSaid])
    expect(parted.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.TurnEnded,
    ])
  })
})

const turnEnded = (endedAt: string): TranscriptEntry => ({
  kind: EEntryKind.TurnEnded,
  author: EAuthor.Model,
  key: `turn-${endedAt}`,
  text: '',
  durationMs: 1_000,
  outputTokens: 0,
  endedAt,
  interrupted: false,
})

const said = (text: string): TranscriptEntry => ({
  kind: EEntryKind.ModelSaid,
  author: EAuthor.Model,
  key: text,
  text,
  streaming: false,
  interrupted: false,
  muted: false,
})

describe('the instant the last turn settled at', () => {
  it('reads the latest turn that ended, whatever was drawn after it', () => {
    expect(
      settledAtOf([
        turnEnded('2026-08-28T18:32:00.000Z'),
        said('a notice-like row'),
        turnEnded('2026-08-28T18:40:00.000Z'),
        said('still running somewhere else'),
      ]),
    ).toBe('2026-08-28T18:40:00.000Z')
  })

  it('says nothing while no turn has ended', () => {
    expect(settledAtOf([said('half an answer')])).toBeUndefined()
    expect(settledAtOf([])).toBeUndefined()
  })
})
