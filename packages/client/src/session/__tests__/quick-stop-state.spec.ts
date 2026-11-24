import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EAttachmentStore,
  EMessageOrigin,
  ERewindCause,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  toRunId,
  toThreadId,
  type Attachment,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import {
  EMPTY_QUICK_STOP_STATE,
  QUICK_STOP_EVIDENCE_LIMIT,
  stepQuickStop,
  type QuickStopState,
} from '../quick-stop-state'

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-24T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const stateOf = (events: readonly V2Event[]): QuickStopState =>
  events.reduce(stepQuickStop, EMPTY_QUICK_STOP_STATE)

const started: V2Body = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }

const thought: V2Body = { type: 'assistant-said', parts: [{ type: 'reasoning', text: 'hm' }] }

const ended: V2Body = {
  type: 'turn-ended',
  turnId: 'turn-1',
  outcome: ETurnOutcome.Stopped,
  by: ETurnEndedBy.Operator,
}

const quickStop = (toSeq: number): V2Body => ({
  type: 'history-rewound',
  toSeq,
  draft: 'back',
  cause: ERewindCause.QuickStop,
})

const shot: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

const turnOf = (text: string, turnId: string): readonly V2Body[] => [
  { type: 'user-said', text, clientId: 'client-a' },
  { type: 'turn-started', turnId, cause: ETurnCause.Input },
  thought,
  { type: 'turn-ended', turnId, outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator },
]

describe('stepQuickStop', () => {
  it('keeps the hidden prompt of a quick stop as evidence', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'think it over', clientId: 'client-a', attachments: [shot] },
      started,
      thought,
      ended,
      quickStop(0),
    ])

    expect(stateOf(events).evidence).toEqual([
      {
        rewindEventId: events.at(-1)?.id ?? '',
        messages: [{ clientId: 'client-a', text: 'think it over', attachments: [shot] }],
      },
    ])
  })

  it('resolves the client id of a prompt from its unsaid inbox row', () => {
    const state = stateOf(
      eventsOf([
        {
          type: 'input-posted',
          inboxId: 4,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'think it over', clientId: 'client-a' },
        },
        { type: 'user-said', text: 'think it over', inboxId: 4 },
        started,
        thought,
        ended,
        quickStop(1),
      ]),
    )

    expect(state.clientIdByInbox).toEqual([])
    expect(state.evidence[0]?.messages.map((message) => message.clientId)).toEqual(['client-a'])
  })

  it('keeps an inbox row until its prompt is said', () => {
    const state = stateOf(
      eventsOf([
        {
          type: 'input-posted',
          inboxId: 4,
          kind: 'message',
          postedAt: 'now',
          message: { text: 'queued', clientId: 'client-a' },
        },
      ]),
    )

    expect(state.clientIdByInbox).toEqual([[4, 'client-a']])
  })

  it('drops the prompts of a finished turn once the next turn starts', () => {
    const state = stateOf(eventsOf([...turnOf('first', 'turn-1'), ...turnOf('second', 'turn-2')]))

    expect(state.candidates.map((candidate) => candidate.text)).toEqual(['second'])
  })

  it('drops a prompt that is not from the operator', () => {
    const state = stateOf(
      eventsOf([
        { type: 'user-said', text: 'nightly check', via: EMessageOrigin.Routine, clientId: 'c' },
        started,
        thought,
        ended,
        quickStop(0),
      ]),
    )

    expect(state.evidence).toEqual([])
  })

  it('moves only the prompts the quick stop hid into its evidence', () => {
    const events = eventsOf([
      ...turnOf('first', 'turn-1'),
      { type: 'user-said', text: 'second', clientId: 'client-a' },
      { type: 'user-said', text: 'third', clientId: 'client-a' },
      { type: 'turn-started', turnId: 'turn-2', cause: ETurnCause.Input },
      thought,
      {
        type: 'turn-ended',
        turnId: 'turn-2',
        outcome: ETurnOutcome.Stopped,
        by: ETurnEndedBy.Operator,
      },
      quickStop(5),
    ])

    const state = stateOf(events)

    expect(state.evidence.map((entry) => entry.messages.map((message) => message.text))).toEqual([
      ['third'],
    ])
    expect(state.candidates.map((candidate) => candidate.text)).toEqual(['second'])
  })

  it('drops the prompts after a rewind the operator asked for', () => {
    const state = stateOf(
      eventsOf([
        ...turnOf('first', 'turn-1'),
        { type: 'user-said', text: 'second', clientId: 'client-a' },
        { type: 'history-rewound', toSeq: 2, draft: 'second' },
      ]),
    )

    expect(state.candidates.map((candidate) => candidate.text)).toEqual(['first'])
    expect(state.evidence).toEqual([])
  })
})

describe('the size of the quick stop state', () => {
  it('keeps a handful of prompts and the last evidence entries over a hundred quick-stopped turns', () => {
    const bodies = Array.from({ length: 100 }, (_, index) => {
      const turnId = `turn-${index}`
      const promptSeq = index * 5 + 1
      return [...turnOf(`prompt ${index}`, turnId), quickStop(promptSeq - 1)]
    }).flat()

    const state = stateOf(eventsOf(bodies))

    expect(state.candidates).toEqual([])
    expect(state.clientIdByInbox).toEqual([])
    expect(state.evidence).toHaveLength(QUICK_STOP_EVIDENCE_LIMIT)
    expect(state.evidence.at(-1)?.messages.map((message) => message.text)).toEqual(['prompt 99'])
  })

  it('keeps at most the prompts of the turn that is open over a hundred turns', () => {
    const bodies = Array.from({ length: 100 }, (_, index) =>
      turnOf(`prompt ${index}`, `turn-${index}`),
    )

    const state = stateOf(eventsOf(bodies.flat()))

    expect(state.candidates.map((candidate) => candidate.text)).toEqual(['prompt 99'])
  })
})
