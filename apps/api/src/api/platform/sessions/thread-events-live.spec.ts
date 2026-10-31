import {
  EThreadStreamFrame,
  type ThreadEventsLiveFrame,
  type ThreadEventsSnapshot,
} from '@dltech/atlas-wire'
import { afterEach, describe, expect, it } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import {
  eventBatch,
  flushEventStream,
  openOrderedEvents,
  streamEvent,
} from './thread-events-live.fixture'
import { THREAD_STREAM_BUFFER_LIMIT } from './thread-stream'

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

const consume = (opened: ReturnType<typeof openOrderedEvents>) => {
  closers.push(opened.close)
  const frames: ThreadEventsLiveFrame[] = []
  const done = (async () => {
    for await (const [id, data] of opened.stream) frames.push({ id, data })
  })()
  return { frames, done }
}

describe('orderedThreadEvents', () => {
  it('waits for subscriber ACK and bootstraps current state without downloading history', async () => {
    const subscription = Promise.withResolvers<void>()
    const opened = openOrderedEvents({ subscription: subscription.promise })
    const { frames, done } = consume(opened)
    await flushEventStream()
    expect(opened.readSnapshot).not.toHaveBeenCalled()
    subscription.resolve()
    await waitFor(() => expect(frames).toHaveLength(3))
    expect(frames[0]).toEqual({
      id: 'v1:0:3',
      data: { type: EThreadStreamFrame.Head, head: 3, historyRev: 0 },
    })
    expect(opened.readSnapshot.mock.calls).toEqual([[{ stateOnly: true }]])
    expect(frames.map((frame) => frame.id)).toEqual(['v1:0:3', 'v1:0:3', 'v1:0:3'])
    opened.close()
    await done
  })

  it('delivers inline events once and does not read on the accompanying legacy-compatible Head', async () => {
    const opened = openOrderedEvents()
    const { frames, done } = consume(opened)
    await waitFor(() => expect(frames).toHaveLength(3))
    await opened.signals.eventsAppended({
      threadId: 'thr_1',
      events: [streamEvent(4)],
      head: 4,
      historyRev: 0,
    })
    await waitFor(() => expect(frames).toHaveLength(4))
    expect(frames[3]).toEqual({ id: 'v1:0:4', data: eventBatch({ seqs: [4] }) })
    await opened.publish(eventBatch({ seqs: [4] }))
    await flushEventStream()
    expect(frames).toHaveLength(4)
    expect(opened.readSnapshot).toHaveBeenCalledTimes(1)
    opened.close()
    await done
  })

  it('keeps the bootstrap checkpoint behind unsent resume backlog and reads only its suffix', async () => {
    const opened = openOrderedEvents({ lastEventId: 'v1:0:1' })
    const { frames, done } = consume(opened)
    await waitFor(() => expect(frames).toHaveLength(4))
    expect(frames[0]?.id).toBe('v1:0:1')
    expect(frames[1]).toEqual({ id: 'v1:0:3', data: eventBatch({ seqs: [2, 3] }) })
    expect(opened.readSnapshot.mock.calls).toEqual([[{ stateOnly: true }], [{ fromSeq: 2 }]])
    opened.close()
    await done
  })

  it('suppresses stale in-flight catchup and queued old rows when a newer Reset arrives', async () => {
    const delayed = Promise.withResolvers<ThreadEventsSnapshot>()
    let historyRev = 0
    const opened = openOrderedEvents({
      readSnapshot: async (args) => {
        if (args.stateOnly === true) return { head: 3, historyRev, events: [] }
        return delayed.promise
      },
    })
    const { frames, done } = consume(opened)
    await waitFor(() => expect(frames).toHaveLength(3))
    await opened.publish(eventBatch({ seqs: [5] }))
    await waitFor(() => expect(opened.readSnapshot).toHaveBeenCalledTimes(2))
    await opened.publish(eventBatch({ seqs: [4] }))
    historyRev = 1
    await opened.publish({ type: EThreadStreamFrame.Reset, head: 3, historyRev })
    delayed.resolve({ head: 5, historyRev: 0, events: [streamEvent(4), streamEvent(5)] })
    await waitFor(() => expect(frames).toHaveLength(4))
    expect(frames[3]).toEqual({
      id: 'v1:1:3',
      data: { type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 },
    })
    expect(frames.some((frame) => frame.data.type === EThreadStreamFrame.Events)).toBe(false)
    opened.close()
    await done
  })

  it('repairs a destructive commit observed while the initial snapshot is in flight', async () => {
    const delayed = Promise.withResolvers<ThreadEventsSnapshot>()
    let reads = 0
    const opened = openOrderedEvents({
      readSnapshot: async () => {
        reads += 1
        if (reads === 1) return delayed.promise
        return { head: 3, historyRev: 1, events: [] }
      },
    })
    const { frames, done } = consume(opened)
    await waitFor(() => expect(opened.readSnapshot).toHaveBeenCalledTimes(1))
    await opened.publish({ type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 })
    delayed.resolve({ head: 3, historyRev: 0, events: [] })
    await waitFor(() => expect(frames).toHaveLength(3))
    expect(frames[0]).toEqual({
      id: 'v1:1:3',
      data: { type: EThreadStreamFrame.Head, head: 3, historyRev: 1 },
    })
    expect(frames.every((frame) => frame.id === 'v1:1:3')).toBe(true)
    opened.close()
    await done
  })

  it('bounds slow-consumer delivery after bootstrap and drops queued rows on overflow', async () => {
    const opened = openOrderedEvents()
    closers.push(opened.close)
    expect(String((await opened.stream.next()).value?.[0])).toBe('v1:0:3')
    await opened.stream.next()
    await opened.stream.next()
    for (let index = 0; index <= THREAD_STREAM_BUFFER_LIMIT; index += 1) {
      await opened.publish(eventBatch({ seqs: [index + 4] }))
    }
    expect(await opened.stream.next()).toEqual({ value: undefined, done: true })
  })

  it('closes on drain and abort without leaking delayed rows', async () => {
    for (const stop of ['drain', 'abort']) {
      const opened = openOrderedEvents()
      const { frames, done } = consume(opened)
      await waitFor(() => expect(frames).toHaveLength(3))
      if (stop === 'drain') opened.drain.beginDrain()
      else opened.controller.abort()
      await done
      expect(frames).toHaveLength(3)
    }
  })
})
