import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { describe, expect, it, mock } from 'bun:test'
import { EVENT_INLINE_LIMIT_BYTES } from './event-change-publisher'
import { recordingSignals } from './thread-signals.fixture'
import { streamEvent } from './thread-events-live.fixture'

describe('committed event signal publication', () => {
  it('publishes stored event rows plus a legacy Head and one metadata update', async () => {
    const { signals, framesOf } = recordingSignals()
    const changed = mock(() => {})
    signals.threadChanged = changed
    const frames = framesOf('thr_1')
    const events = [streamEvent(4), streamEvent(5)]
    await signals.eventsAppended({ threadId: 'thr_1', events, head: 5, historyRev: 2 })
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 4, events, historyRev: 2 },
      { type: EThreadStreamFrame.Head, head: 5, historyRev: 2 },
    ])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith({ threadId: 'thr_1' })
    await signals.onModuleDestroy()
  })

  it('turns an oversized publication into a bounded durable catchup hint', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr_1')
    const huge = { ...streamEvent(4), body: '界'.repeat(EVENT_INLINE_LIMIT_BYTES) }
    await signals.eventsAppended({ threadId: 'thr_1', events: [huge], head: 4, historyRev: 2 })
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 4, events: [], historyRev: 2 },
      { type: EThreadStreamFrame.Head, head: 4, historyRev: 2 },
    ])
    expect(
      Buffer.byteLength(JSON.stringify({ threadId: 'thr_1', frame: frames[0] })),
    ).toBeLessThanOrEqual(EVENT_INLINE_LIMIT_BYTES)
    await signals.onModuleDestroy()
  })

  it('publishes Reset plus legacy Head even when the head is unchanged', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr_1')
    await signals.eventsReset({ threadId: 'thr_1', head: 5, historyRev: 3 })
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Reset, head: 5, historyRev: 3 },
      { type: EThreadStreamFrame.Head, head: 5, historyRev: 3 },
    ])
    await signals.onModuleDestroy()
  })

  it('does not announce a reused-only or idempotently retried append', async () => {
    const { signals, framesOf } = recordingSignals()
    const changed = mock(() => {})
    signals.threadChanged = changed
    const frames: ThreadStreamFrame[] = framesOf('thr_1')
    await signals.eventsAppended({ threadId: 'thr_1', events: [], head: 5, historyRev: 2 })
    expect(frames).toEqual([])
    expect(changed).not.toHaveBeenCalled()
    await signals.onModuleDestroy()
  })
})
