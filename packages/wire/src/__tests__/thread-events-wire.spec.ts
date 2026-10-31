import { describe, expect, it } from 'bun:test'
import {
  EThreadStreamFrame,
  threadEventsLiveInputSchema,
  threadEventsLiveOutputSchema,
  threadEventsSnapshotInputSchema,
  threadEventsSnapshotOutputSchema,
  threadStreamFrameSchema,
  type ThreadStreamFrame,
  type ThreadEventsLiveFrame,
} from '../index'

describe('ordered event wire', () => {
  it('keeps epochs optional for legacy frames and validates supplied epochs', () => {
    const frames = [
      { type: EThreadStreamFrame.Head, head: 7 },
      { type: EThreadStreamFrame.Events, fromSeq: 8, events: [] },
      { type: EThreadStreamFrame.Reset, head: 7 },
    ] satisfies ThreadStreamFrame[]
    for (const frame of frames) {
      expect(threadStreamFrameSchema.parse(frame)).toEqual(frame)
      expect(threadStreamFrameSchema.parse({ ...frame, historyRev: 2 })).toEqual({
        ...frame,
        historyRev: 2,
      })
      for (const historyRev of [-1, 0.5, Number.POSITIVE_INFINITY]) {
        expect(threadStreamFrameSchema.safeParse({ ...frame, historyRev }).success).toBe(false)
      }
    }
  })

  it('accepts only live inputs with thread identity and optional opaque cursor', () => {
    expect(
      threadEventsLiveInputSchema.parse({ threadId: 'thread', lastEventId: 'v1:2:7' }),
    ).toEqual({ threadId: 'thread', lastEventId: 'v1:2:7' })
    expect(threadEventsLiveInputSchema.safeParse({ threadId: '' }).success).toBe(false)
    expect(threadEventsLiveInputSchema.safeParse({ threadId: 'thread', metaRev: 1 }).success).toBe(
      false,
    )
  })

  it('accepts tracked async iterables without importing a transport runtime', () => {
    const frames = (async function* (): AsyncGenerator<ThreadEventsLiveFrame> {
      yield { id: 'v1:0:7', data: { type: EThreadStreamFrame.Head, head: 7, historyRev: 0 } }
    })()
    expect(threadEventsLiveOutputSchema.parse(frames)).toBe(frames)
    expect(threadEventsLiveOutputSchema.safeParse([]).success).toBe(false)
  })

  it('accepts an inclusive zero lower bound and an atomic own-row snapshot', () => {
    expect(threadEventsSnapshotInputSchema.parse({ threadId: 'thread', fromSeq: 0 })).toEqual({
      threadId: 'thread',
      fromSeq: 0,
    })
    expect(threadEventsSnapshotOutputSchema.parse({ events: [], historyRev: 3, head: 7 })).toEqual({
      events: [],
      historyRev: 3,
      head: 7,
    })
    expect(
      threadEventsSnapshotInputSchema.safeParse({ threadId: 'thread', own: true }).success,
    ).toBe(false)
    expect(
      threadEventsSnapshotInputSchema.safeParse({ threadId: 'thread', fromSeq: -1 }).success,
    ).toBe(false)
    expect(threadEventsSnapshotOutputSchema.safeParse({ events: [], head: 7 }).success).toBe(false)
  })
})
