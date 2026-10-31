import { EThreadStreamFrame, type ThreadEventsSnapshot } from '@dltech/atlas-wire'
import { describe, expect, it, mock } from 'bun:test'
import { decodeThreadEventCursor, encodeThreadEventCursor } from './thread-event-cursor'
import { ThreadEventOrder } from './thread-event-order'
import { eventBatch, streamEvent } from './thread-events-live.fixture'

const snapshot = (args: { head?: number; historyRev?: number; seqs?: number[] } = {}) => ({
  head: args.head ?? 3,
  historyRev: args.historyRev ?? 0,
  events: (args.seqs ?? []).map(streamEvent),
})

const openOrder = async (
  args: { lastEventId?: string; head?: number; historyRev?: number } = {},
) => {
  const read = mock(async () => snapshot({ head: 5, seqs: [4, 5] }))
  const order = new ThreadEventOrder(read)
  const initial = await order.open({ snapshot: snapshot(args), lastEventId: args.lastEventId })
  return { order, read, initial }
}

describe('thread event cursor', () => {
  it('encodes only epoch and delivered sequence with safe nonnegative integer parsing', () => {
    expect(encodeThreadEventCursor({ historyRev: 2, seq: 7 })).toBe('v1:2:7')
    expect(decodeThreadEventCursor('v1:2:7')).toEqual({ historyRev: 2, seq: 7 })
    for (const value of [
      undefined,
      '',
      '7',
      'v1:0:-1',
      'v1:-1:0',
      'v1:1:1.5',
      'v1:01:1',
      'v2:0:0',
      'v1:9007199254740992:1',
      'v1:0:9007199254740992',
      'v1:0:0:1',
    ]) {
      expect(decodeThreadEventCursor(value)).toBeUndefined()
    }
  })
})

describe('ThreadEventOrder', () => {
  it('baselines a fresh subscription without reading historical rows', async () => {
    const { order, read, initial } = await openOrder()
    expect(initial).toEqual({ type: EThreadStreamFrame.Head, head: 3, historyRev: 0 })
    expect(order.cursor).toEqual({ historyRev: 0, seq: 3 })
    expect(read).not.toHaveBeenCalled()
  })

  it('does not advance a resumed checkpoint when advertising the current head', async () => {
    const { order, initial, read } = await openOrder({ lastEventId: 'v1:0:1' })
    expect(initial).toEqual({ type: EThreadStreamFrame.Head, head: 3, historyRev: 0 })
    expect(order.cursor.seq).toBe(1)
    expect(read).not.toHaveBeenCalled()
  })

  it('accepts contiguous inline rows without database reads and dedupes overlaps', async () => {
    const { order, read } = await openOrder()
    expect(await order.accept(eventBatch({ seqs: [3, 4, 5] }))).toEqual(
      eventBatch({ seqs: [4, 5] }),
    )
    expect(await order.accept(eventBatch({ seqs: [4, 5] }))).toBeUndefined()
    expect(
      await order.accept({ type: EThreadStreamFrame.Head, head: 3, historyRev: 0 }),
    ).toBeUndefined()
    expect(order.cursor.seq).toBe(5)
    expect(read).not.toHaveBeenCalled()
  })

  it('backfills a gap once and discards reordered batches after recovery', async () => {
    const { order, read } = await openOrder()
    expect(await order.accept(eventBatch({ seqs: [5] }))).toEqual(eventBatch({ seqs: [4, 5] }))
    expect(read).toHaveBeenCalledWith({ fromSeq: 4 })
    expect(await order.accept(eventBatch({ seqs: [4] }))).toBeUndefined()
    expect(
      await order.accept({ type: EThreadStreamFrame.Head, head: 5, historyRev: 0 }),
    ).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('recovers empty oversize hints and unversioned legacy Head hints with bounded reads', async () => {
    for (const frame of [
      eventBatch({ seqs: [] }),
      { type: EThreadStreamFrame.Head, head: 5 } as const,
    ]) {
      const { order, read } = await openOrder()
      expect(await order.accept(frame)).toEqual(eventBatch({ seqs: [4, 5] }))
      expect(read).toHaveBeenCalledWith({ fromSeq: 4 })
    }
  })

  it('resets rather than fabricating a sparse imported suffix', async () => {
    const read = mock(async () => snapshot({ head: 5, seqs: [5] }))
    const order = new ThreadEventOrder(read)
    await order.open({ snapshot: snapshot(), lastEventId: 'v1:0:3' })
    expect(await order.catchUp()).toEqual({
      type: EThreadStreamFrame.Reset,
      head: 5,
      historyRev: 0,
    })
    expect(order.cursor).toEqual({ historyRev: 0, seq: 5 })
  })

  it('resets malformed, ahead, disconnected summary, and rewind-regrow cursors', async () => {
    for (const lastEventId of ['garbage', 'v1:0:9', 'v1:0:3']) {
      const { order, initial, read } = await openOrder({ lastEventId, historyRev: 1 })
      expect(initial).toEqual({ type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 })
      expect(order.cursor).toEqual({ historyRev: 1, seq: 3 })
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('resets a same-epoch cursor ahead of the head without downloading history', async () => {
    const { order, initial, read } = await openOrder({ lastEventId: 'v1:1:9', historyRev: 1 })
    expect(initial).toEqual({ type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 })
    expect(order.cursor).toEqual({ historyRev: 1, seq: 3 })
    expect(read).not.toHaveBeenCalled()
  })

  it('resets at a coherent head when a newer epoch arrives before its publication', async () => {
    const read = mock(async () => snapshot({ historyRev: 2, head: 3 }))
    const order = new ThreadEventOrder(read)
    await order.open({ snapshot: snapshot(), lastEventId: undefined })
    const reset = { type: EThreadStreamFrame.Reset, head: 1, historyRev: 1 } as const
    order.observe(reset)
    expect(await order.accept(reset)).toEqual({
      type: EThreadStreamFrame.Reset,
      head: 3,
      historyRev: 2,
    })
    expect(read).toHaveBeenCalledWith({ stateOnly: true })
    expect(await order.accept(eventBatch({ seqs: [4], historyRev: 0 }))).toBeUndefined()
    expect(await order.accept(reset)).toBeUndefined()
  })

  it('suppresses a delayed old-epoch read after Reset immediately invalidates it', async () => {
    const delayed = Promise.withResolvers<ThreadEventsSnapshot>()
    const read = mock(async () => delayed.promise)
    const order = new ThreadEventOrder(read)
    await order.open({ snapshot: snapshot(), lastEventId: undefined })
    const pending = order.catchUp()
    order.observe({ type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 })
    delayed.resolve(snapshot({ head: 5, seqs: [4, 5] }))
    expect(await pending).toBeUndefined()
    expect(order.cursor).toEqual({ historyRev: 0, seq: 3 })
  })

  it('detects an epoch change in the locked read even when the notification was missed', async () => {
    const order = new ThreadEventOrder(async () => snapshot({ historyRev: 1, head: 3 }))
    await order.open({ snapshot: snapshot(), lastEventId: undefined })
    expect(await order.accept({ type: EThreadStreamFrame.Head, head: 3 })).toEqual({
      type: EThreadStreamFrame.Reset,
      head: 3,
      historyRev: 1,
    })
  })
})
