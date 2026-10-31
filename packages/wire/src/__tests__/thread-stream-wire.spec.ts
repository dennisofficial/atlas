import { describe, expect, it } from 'bun:test'

import {
  EThreadStreamFrame,
  threadStreamFrameSchema,
  threadStreamInputSchema,
  threadStreamOutputSchema,
} from '../index'

describe('the thread stream wire', () => {
  it('parses each frame kind', () => {
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Head, head: 7 })).toEqual({
      type: EThreadStreamFrame.Head,
      head: 7,
    })
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Pod })).toEqual({
      type: EThreadStreamFrame.Pod,
    })
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Heartbeat })).toEqual({
      type: EThreadStreamFrame.Heartbeat,
    })
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Title })).toEqual({
      type: EThreadStreamFrame.Title,
    })
  })

  it('parses the state-carrying frames', () => {
    const thread = {
      id: 'thr_1',
      head: 3,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
      workspace: null,
      repo: null,
    }
    const event = {
      id: 'evt_4',
      threadId: 'thr_1',
      seq: 4,
      runId: 'run_1',
      depth: 0,
      at: '2026-10-31T00:00:00.000Z',
      type: 'assistant',
      body: '{}',
    }
    const frames: unknown[] = [
      { type: EThreadStreamFrame.Meta, thread, rev: 5 },
      { type: EThreadStreamFrame.Events, fromSeq: 4, events: [event] },
      { type: EThreadStreamFrame.Events, fromSeq: 4, events: [] },
      { type: EThreadStreamFrame.Reset, head: 2 },
      { type: EThreadStreamFrame.Pod, status: { state: 'running', steps: [] } },
      { type: EThreadStreamFrame.Pod, status: { state: 'running', steps: [] }, rev: 7 },
    ]
    for (const frame of frames) {
      const parsed = threadStreamFrameSchema.safeParse(frame)
      expect(parsed.success).toBe(true)
      expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(frame))
    }
  })

  it('rejects a meta frame without a rev and an events frame with a negative fromSeq', () => {
    expect(threadStreamFrameSchema.safeParse({ type: 'meta', thread: {} }).success).toBe(false)
    expect(
      threadStreamFrameSchema.safeParse({ type: 'events', fromSeq: -1, events: [] }).success,
    ).toBe(false)
  })

  it('keeps Pod rev optional and rejects invalid revisions', () => {
    for (const rev of [0, 7]) {
      const frame = { type: EThreadStreamFrame.Pod, rev } as const
      expect(threadStreamFrameSchema.parse(frame)).toEqual(frame)
    }
    for (const rev of [-1, 1.5, '1', null]) {
      expect(threadStreamFrameSchema.safeParse({ type: EThreadStreamFrame.Pod, rev }).success).toBe(
        false,
      )
    }
  })

  it('rejects a head frame without an integer head and an unknown kind', () => {
    expect(threadStreamFrameSchema.safeParse({ type: 'head' }).success).toBe(false)
    expect(threadStreamFrameSchema.safeParse({ type: 'head', head: 1.5 }).success).toBe(false)
    expect(threadStreamFrameSchema.safeParse({ type: 'mystery' }).success).toBe(false)
  })

  it('takes a strict input carrying a non-empty threadId', () => {
    expect(threadStreamInputSchema.safeParse({ threadId: 'thr_1' }).success).toBe(true)
    expect(threadStreamInputSchema.safeParse({ threadId: '' }).success).toBe(false)
    expect(threadStreamInputSchema.safeParse({ threadId: 'thr_1', extra: 1 }).success).toBe(false)
  })

  it('accepts an async iterable as the output and nothing else', async () => {
    async function* frames() {
      yield { type: EThreadStreamFrame.Heartbeat }
    }

    expect(threadStreamOutputSchema.safeParse(frames()).success).toBe(true)
    expect(threadStreamOutputSchema.safeParse([]).success).toBe(false)
    expect(threadStreamOutputSchema.safeParse(null).success).toBe(false)
  })
})
