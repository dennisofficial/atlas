import { describe, expect, it } from 'bun:test'

import type { Event, ThreadId } from '@dltech/atlas-core'
import { EWake } from '@dltech/atlas-observability'

import type { AgentRecordPort } from '../../record/agent-record.port'
import { createWakeTracker, promptAtOf, promptQueuedMsOf, turnWaitOf } from '../turn-wait'

const THREAD = 'thr-1' as ThreadId

const event = (args: { type: string; at: string; inboxId?: number | undefined }) =>
  ({
    id: 'evt-1',
    seq: 1,
    threadId: THREAD,
    runId: 'run-1',
    depth: 0,
    ...args,
  }) as unknown as Event

const record = (
  events: readonly Event[],
  over: { posted?: ReadonlyMap<number, string>; queued?: string | null } = {},
): AgentRecordPort =>
  ({
    ownEvents: async () => [...events],
    postedInputAts: async () => over.posted ?? new Map(),
    queuedSince: () => over.queued ?? null,
  }) as unknown as AgentRecordPort

describe('promptQueuedMsOf', () => {
  it('measures from the prompt post time', () => {
    expect(
      promptQueuedMsOf({
        now: Date.parse('2026-11-20T10:00:32.500Z'),
        promptAt: Date.parse('2026-11-20T10:00:30.000Z'),
      }),
    ).toBe(2500)
  })

  it('is absent when the turn answers no prompt', () => {
    expect(promptQueuedMsOf({ now: 1, promptAt: undefined })).toBeUndefined()
  })

  it('is zero rather than negative on a clock that stepped back', () => {
    expect(
      promptQueuedMsOf({
        now: Date.parse('2026-11-20T10:00:00.000Z'),
        promptAt: Date.parse('2026-11-20T10:00:05.000Z'),
      }),
    ).toBe(0)
  })
})

describe('promptAtOf', () => {
  it('times an inbox-backed prompt from its post time, not from when it reached the log', async () => {
    expect(
      await promptAtOf({
        record: record([], { posted: new Map([[7, '2026-11-20T10:00:00.000Z']]) }),
        events: [event({ type: 'user-said', at: '2026-11-20T10:00:05.000Z', inboxId: 7 })],
        threadId: THREAD,
      }),
    ).toBe(Date.parse('2026-11-20T10:00:00.000Z'))
  })

  it('times a prompt that never came through the inbox from its own stamp', async () => {
    expect(
      await promptAtOf({
        record: record([]),
        events: [event({ type: 'user-said', at: '2026-11-20T10:00:05.000Z' })],
        threadId: THREAD,
      }),
    ).toBe(Date.parse('2026-11-20T10:00:05.000Z'))
  })

  it('times the prompt the log holds over a queue that arrived behind it', async () => {
    expect(
      await promptAtOf({
        record: record([], {
          posted: new Map([[7, '2026-11-20T10:00:04.000Z']]),
          queued: '2026-11-20T10:00:30.000Z',
        }),
        events: [event({ type: 'user-said', at: '2026-11-20T10:00:05.000Z', inboxId: 7 })],
        threadId: THREAD,
      }),
    ).toBe(Date.parse('2026-11-20T10:00:04.000Z'))
  })

  it('falls back to the post time of a prompt the inbox holds and the log does not', async () => {
    expect(
      await promptAtOf({
        record: record([], { queued: '2026-11-20T10:00:02.000Z' }),
        events: [event({ type: 'assistant-said', at: '2026-11-20T10:00:00.000Z' })],
        threadId: THREAD,
      }),
    ).toBe(Date.parse('2026-11-20T10:00:02.000Z'))
  })

  it('is absent when the turn answers neither a said prompt nor a queued one', async () => {
    expect(
      await promptAtOf({
        record: record([]),
        events: [event({ type: 'assistant-said', at: '2026-11-20T10:00:00.000Z' })],
        threadId: THREAD,
      }),
    ).toBeUndefined()
  })
})

describe('turnWaitOf', () => {
  it('reports warm on a thread whose earlier turn ran through another record instance', async () => {
    const events = [event({ type: 'user-said', at: '2026-11-20T10:00:00.000Z' })]

    expect(
      await turnWaitOf({
        record: record(events),
        threadId: THREAD,
        now: Date.parse('2026-11-20T10:00:01.000Z'),
      }),
    ).toEqual({
      fields: { wake: EWake.Cold, queuedMs: 1000 },
      promptAt: Date.parse('2026-11-20T10:00:00.000Z'),
    })
    expect(
      await turnWaitOf({
        record: record(events),
        threadId: THREAD,
        now: Date.parse('2026-11-20T10:00:02.000Z'),
      }),
    ).toEqual({
      fields: { wake: EWake.Warm, queuedMs: 2000 },
      promptAt: Date.parse('2026-11-20T10:00:00.000Z'),
    })
  })

  it('reports cold for the first turn of every thread', async () => {
    const wakes = createWakeTracker()
    const turnOf = (threadId: string, now: number) =>
      turnWaitOf({
        record: record([]),
        threadId: threadId as ThreadId,
        now,
        wakes,
      })

    expect((await turnOf('thr-a', 0)).fields).toEqual({ wake: EWake.Cold })
    expect((await turnOf('thr-b', 0)).fields).toEqual({ wake: EWake.Cold })
    expect((await turnOf('thr-a', 0)).fields).toEqual({ wake: EWake.Warm })
  })

  it('carries the queued input post time even when no user-said marks the turn yet', async () => {
    expect(
      await turnWaitOf({
        record: record([], { queued: '2026-11-20T10:00:00.000Z' }),
        threadId: 'thr-queued' as ThreadId,
        now: Date.parse('2026-11-20T10:00:19.000Z'),
        wakes: createWakeTracker(),
      }),
    ).toEqual({
      fields: { wake: EWake.Cold, queuedMs: 19000 },
      promptAt: Date.parse('2026-11-20T10:00:00.000Z'),
    })
  })

  it('carries the wake and the queue on a resume too', async () => {
    expect(
      await turnWaitOf({
        record: record([event({ type: 'user-said', at: '2026-11-20T10:00:00.000Z' })]),
        threadId: 'thr-resume' as ThreadId,
        now: Date.parse('2026-11-20T10:00:04.000Z'),
        wakes: createWakeTracker(),
      }),
    ).toEqual({
      fields: { wake: EWake.Cold, queuedMs: 4000 },
      promptAt: Date.parse('2026-11-20T10:00:00.000Z'),
    })
  })
})
