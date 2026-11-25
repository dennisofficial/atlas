import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EAttachmentStore,
  EMessageOrigin,
  ERewindCause,
  ETurnCause,
  toRunId,
  toThreadId,
  type Attachment,
  type RecordEventBody,
} from '@dltech/atlas-core'

import {
  quickStopRestoresOf,
  quickStopRestoresToApply,
  quickStopsOf,
  type QuickStopEvidence,
} from '../quick-stop-restore'

const eventsOf = (bodies: readonly RecordEventBody[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-24T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const said = (
  text: string,
  over: Partial<{ clientId: string; inboxId: number }> = {},
): RecordEventBody => ({
  type: 'user-said',
  text,
  ...over,
})

const started: RecordEventBody = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }

const thought: RecordEventBody = {
  type: 'assistant-said',
  parts: [{ type: 'reasoning', text: 'hm' }],
}

const ended: RecordEventBody = {
  type: 'turn-ended',
  turnId: 'turn-1',
  outcome: 'stopped' as never,
  by: 'operator' as never,
}

const quickStop = (toSeq: number, draft: string): RecordEventBody => ({
  type: 'history-rewound',
  toSeq,
  draft,
  cause: ERewindCause.QuickStop,
})

const shot: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

describe('quickStopRestoresOf', () => {
  it('returns the message this client sent under a quick stop', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'think it over', clientId: 'client-a', attachments: [shot] },
      started,
      thought,
      ended,
      quickStop(0, 'think it over'),
    ])

    const restores = quickStopRestoresOf({
      quickStops: quickStopsOf(events),
      clientIds: ['client-a'],
    })

    expect(restores.length).toBe(1)
    expect(restores[0]?.rewindEventId).toBe(events.at(-1)?.id)
    expect(restores[0]?.text).toBe('think it over')
    expect(restores[0]?.attachments).toEqual([shot])
  })

  it('leaves another client of the same session alone', () => {
    const events = eventsOf([
      said('think it over', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(0, 'think it over'),
    ])

    expect(
      quickStopRestoresOf({ quickStops: quickStopsOf(events), clientIds: ['client-b'] }),
    ).toEqual([])
  })

  it('resolves the sender of a prompt from its input-posted row', () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 4,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'think it over', clientId: 'client-a' },
      },
      said('think it over', { inboxId: 4 }),
      started,
      thought,
      ended,
      quickStop(1, 'think it over'),
    ])

    const restores = quickStopRestoresOf({
      quickStops: quickStopsOf(events),
      clientIds: ['client-a'],
    })

    expect(restores.map((restore) => restore.text)).toEqual(['think it over'])
  })

  it('joins two queued prompts into one restore', () => {
    const events = eventsOf([
      said('first', { clientId: 'client-a' }),
      said('second', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(0, 'first\n\nsecond'),
    ])

    const restores = quickStopRestoresOf({
      quickStops: quickStopsOf(events),
      clientIds: ['client-a'],
    })

    expect(restores.map((restore) => restore.text)).toEqual(['first\n\nsecond'])
  })

  it('ignores a rewind that the operator asked for', () => {
    const events = eventsOf([
      said('first', { clientId: 'client-a' }),
      { type: 'history-rewound', toSeq: 0, draft: 'first' },
    ])

    expect(
      quickStopRestoresOf({ quickStops: quickStopsOf(events), clientIds: ['client-a'] }),
    ).toEqual([])
  })

  it('returns one entry per quick stop, each once', () => {
    const events = eventsOf([
      said('first', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(0, 'first'),
      said('second', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(5, 'second'),
    ])

    const restores = quickStopRestoresOf({
      quickStops: quickStopsOf(events),
      clientIds: ['client-a'],
    })

    expect(restores.map((restore) => restore.text)).toEqual(['first', 'second'])
  })
})

describe('quickStopRestoresToApply', () => {
  it('skips a rewind this client already put back', () => {
    const events = eventsOf([
      said('first', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(0, 'first'),
    ])
    const [restore] = quickStopRestoresOf({
      quickStops: quickStopsOf(events),
      clientIds: ['client-a'],
    })

    expect(
      quickStopRestoresToApply({
        quickStops: quickStopsOf(events),
        clientIds: ['client-a'],
        handled: new Set([restore?.rewindEventId ?? '']),
      }),
    ).toEqual([])
  })

  it('applies a rewind this client has not handled yet', () => {
    const events = eventsOf([
      said('first', { clientId: 'client-a' }),
      started,
      thought,
      ended,
      quickStop(0, 'first'),
    ])

    expect(
      quickStopRestoresToApply({
        quickStops: quickStopsOf(events),
        clientIds: ['client-a'],
        handled: new Set(),
      }),
    ).toHaveLength(1)
  })
})

describe('quickStopsOf', () => {
  it('keeps the hidden prompts with the client id of their input-posted row', () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 4,
        kind: 'message',
        postedAt: 'now',
        message: { text: 'think it over', clientId: 'client-a' },
      },
      said('think it over', { inboxId: 4 }),
      started,
      thought,
      ended,
      quickStop(1, 'think it over'),
    ])

    const evidence: readonly QuickStopEvidence[] = quickStopsOf(events)

    expect(evidence).toEqual([
      {
        rewindEventId: events.at(-1)?.id ?? '',
        messages: [{ clientId: 'client-a', text: 'think it over', attachments: [] }],
      },
    ])
  })

  it('drops a prompt that is not from the operator', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'nightly check', via: EMessageOrigin.Routine, clientId: 'c' },
      started,
      thought,
      ended,
      quickStop(0, 'nightly check'),
    ])

    expect(quickStopsOf(events)).toEqual([])
  })
})
