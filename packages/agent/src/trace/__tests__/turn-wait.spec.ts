import { describe, expect, it } from 'bun:test'

import type { Event, ThreadId } from '@dltech/atlas-core'
import { ETurnEntry, EWake } from '@dltech/atlas-observability'

import type { AgentRecordPort } from '../../record/agent-record.port'
import { createWakeTracker, promptQueuedMsOf, turnWaitOf } from '../turn-wait'

const event = (args: { type: string; at: string }) =>
  ({
    id: 'evt-1',
    seq: 1,
    threadId: 'thr-1' as ThreadId,
    runId: 'run-1',
    depth: 0,
    ...args,
  }) as unknown as Event

const record = (events: readonly Event[]): AgentRecordPort =>
  ({
    ownEvents: async () => [...events],
  }) as unknown as AgentRecordPort

describe('promptQueuedMsOf', () => {
  it('measures from the prompt the turn answers', () => {
    const events = [
      event({ type: 'user-said', at: '2026-11-20T10:00:00.000Z' }),
      event({ type: 'user-said', at: '2026-11-20T10:00:30.000Z' }),
    ]
    expect(promptQueuedMsOf({ events, now: Date.parse('2026-11-20T10:00:32.500Z') })).toBe(2500)
  })

  it('is absent when the prompt was already answered', () => {
    const events = [
      event({ type: 'user-said', at: '2026-11-20T10:00:00.000Z' }),
      event({ type: 'assistant-said', at: '2026-11-20T10:00:05.000Z' }),
    ]
    expect(
      promptQueuedMsOf({ events, now: Date.parse('2026-11-20T10:01:00.000Z') }),
    ).toBeUndefined()
  })

  it('is absent when a notice woke the turn', () => {
    const events = [event({ type: 'assistant-said', at: '2026-11-20T10:00:05.000Z' })]
    expect(
      promptQueuedMsOf({ events, now: Date.parse('2026-11-20T10:01:00.000Z') }),
    ).toBeUndefined()
  })

  it('is zero rather than negative on a clock that stepped back', () => {
    const events = [event({ type: 'user-said', at: '2026-11-20T10:00:05.000Z' })]
    expect(promptQueuedMsOf({ events, now: Date.parse('2026-11-20T10:00:00.000Z') })).toBe(0)
  })
})

describe('turnWaitOf', () => {
  it('reports warm on a thread whose earlier turn ran through another record instance', async () => {
    const threadId = 'thr-wake-across-records' as ThreadId
    const events = [event({ type: 'user-said', at: '2026-11-20T10:00:00.000Z' })]

    expect(
      await turnWaitOf({
        record: record(events),
        threadId,
        entry: ETurnEntry.Start,
        now: Date.parse('2026-11-20T10:00:01.000Z'),
      }),
    ).toEqual({ wake: EWake.Cold, queuedMs: 1000 })
    expect(
      await turnWaitOf({
        record: record(events),
        threadId,
        entry: ETurnEntry.Start,
        now: Date.parse('2026-11-20T10:00:02.000Z'),
      }),
    ).toEqual({ wake: EWake.Warm, queuedMs: 2000 })
  })

  it('reports cold for the first turn of every thread', async () => {
    const wakes = createWakeTracker()
    const turnOf = (threadId: string, now: number) =>
      turnWaitOf({
        record: record([]),
        threadId: threadId as ThreadId,
        entry: ETurnEntry.Start,
        now,
        wakes,
      })

    expect(await turnOf('thr-a', 0)).toEqual({ wake: EWake.Cold })
    expect(await turnOf('thr-b', 0)).toEqual({ wake: EWake.Cold })
    expect(await turnOf('thr-a', 0)).toEqual({ wake: EWake.Warm })
  })

  it('carries nothing on a resume', async () => {
    expect(
      await turnWaitOf({
        record: record([]),
        threadId: 'thr-1' as ThreadId,
        entry: ETurnEntry.Resume,
        now: 0,
      }),
    ).toEqual({})
  })
})
