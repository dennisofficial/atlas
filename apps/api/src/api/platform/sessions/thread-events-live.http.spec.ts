import {
  EThreadStreamFrame,
  type ThreadEventsLiveFrame,
  type ThreadEventsSnapshot,
  type WireEvent,
} from '@dltech/atlas-wire'
import { NotFoundException } from '@nestjs/common'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import * as snapshots from './thread-events-snapshot'
import * as metadata from './thread-stream-state'
import * as pods from './pod-snapshot'
import { metadataFrame, podSnapshotFrame } from './thread-stream.fixture'
import { streamEvent } from './thread-events-live.fixture'
import { createLiveEventApp } from './thread-events-live.http.fixture'

describe('threadEvents.live real SSE tracked protocol', () => {
  let fixture: Awaited<ReturnType<typeof createLiveEventApp>>
  let head = 3
  let historyRev = 0
  let events: WireEvent[] = []
  const closeSubscriptions: Array<() => void> = []
  const read = spyOn(snapshots, 'readThreadEventsSnapshot').mockImplementation(async (args) => {
    if (args.userId !== 'usr_1' || args.threadId !== 'thr_1')
      throw new NotFoundException('thread not found')
    return {
      head,
      historyRev,
      events:
        args.stateOnly === true
          ? []
          : events.filter((event) => event.seq >= (args.fromSeq ?? 0) && event.seq <= head),
    }
  })
  const subscribe = (
    args: {
      lastEventId?: string | undefined
      threadId?: string
      sandbox?: boolean
      header?: string
    } = {},
  ) => {
    const frames: ThreadEventsLiveFrame[] = []
    const failures: Array<{ data?: { httpStatus?: number } | null | undefined }> = []
    const subscription = fixture
      .client({ sandbox: args.sandbox, lastEventId: args.header })
      .threadEvents.live.subscribe(
        { threadId: args.threadId ?? 'thr_1', lastEventId: args.lastEventId },
        {
          onData: (frame) => frames.push(frame),
          onError: (failure) => failures.push(failure),
        },
      )
    closeSubscriptions.push(() => subscription.unsubscribe())
    return { frames, failures, close: () => subscription.unsubscribe() }
  }

  beforeAll(async () => {
    spyOn(metadata, 'readThreadMetadata').mockImplementation(async ({ threadId }) =>
      metadataFrame({ threadId }),
    )
    spyOn(pods, 'readPodFrame').mockResolvedValue(podSnapshotFrame())
    fixture = await createLiveEventApp()
  })
  beforeEach(() => {
    head = 3
    historyRev = 0
    events = [1, 2, 3].map(streamEvent)
    read.mockClear()
  })
  afterEach(() => {
    for (const close of closeSubscriptions.splice(0)) close()
  })
  afterAll(async () => {
    await fixture.app.close()
    read.mockRestore()
    spyOn(metadata, 'readThreadMetadata').mockRestore()
    spyOn(pods, 'readPodFrame').mockRestore()
  })

  it('receives actual tracked {id,data} and no initial event transcript', async () => {
    const { frames } = subscribe()
    await waitFor(() => expect(frames).toHaveLength(3))
    expect(frames[0]).toEqual({
      id: 'v1:0:3',
      data: { type: EThreadStreamFrame.Head, head: 3, historyRev: 0 },
    })
    expect(frames.map((frame) => frame.data.type)).toEqual([
      EThreadStreamFrame.Head,
      EThreadStreamFrame.Meta,
      EThreadStreamFrame.Pod,
    ])
    expect(read.mock.calls.map(([args]) => args.stateOnly)).toEqual([true])
    head = 4
    const event = streamEvent(4)
    events.push(event)
    await fixture.signals.eventsAppended({ threadId: 'thr_1', events: [event], head, historyRev })
    await waitFor(() => expect(frames).toHaveLength(4))
    expect(frames[3]).toEqual({
      id: 'v1:0:4',
      data: { type: EThreadStreamFrame.Events, events: [event], fromSeq: 4, historyRev: 0 },
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps legacy raw subscribers unwrapped when event publishers emit additive frames', async () => {
    const frames: unknown[] = []
    const subscription = fixture.client().threadEvents.stream.subscribe(
      { threadId: 'thr_1' },
      {
        onData: (frame) => frames.push(frame),
      },
    )
    closeSubscriptions.push(() => subscription.unsubscribe())
    await waitFor(() => expect(frames).toHaveLength(3))
    await fixture.signals.eventsAppended({
      threadId: 'thr_1',
      events: [streamEvent(4)],
      head: 4,
      historyRev: 0,
    })
    await waitFor(() => expect(frames).toHaveLength(5))
    expect(frames[0]).toEqual({ type: EThreadStreamFrame.Head, head: 3 })
    expect(frames[3]).toEqual({
      type: EThreadStreamFrame.Events,
      fromSeq: 4,
      events: [streamEvent(4)],
      historyRev: 0,
    })
    expect(frames[4]).toEqual({ type: EThreadStreamFrame.Head, head: 4, historyRev: 0 })
  })

  it('resumes with only a suffix using the last delivered tracked ID', async () => {
    const first = subscribe()
    await waitFor(() => expect(first.frames).toHaveLength(3))
    first.close()
    head = 5
    events.push(streamEvent(4), streamEvent(5))
    const resumed = subscribe({ lastEventId: first.frames.at(-1)?.id })
    await waitFor(() => expect(resumed.frames).toHaveLength(4))
    expect(resumed.frames[0]?.id).toBe('v1:0:3')
    expect(resumed.frames[1]).toEqual({
      id: 'v1:0:5',
      data: {
        type: EThreadStreamFrame.Events,
        fromSeq: 4,
        events: [streamEvent(4), streamEvent(5)],
        historyRev: 0,
      },
    })
    expect(
      read.mock.calls.filter(([args]) => args.stateOnly !== true).map(([args]) => args.fromSeq),
    ).toEqual([4])
  })

  it('honors the SSE Last-Event-ID header injected by the installed tRPC transport', async () => {
    const { frames } = subscribe({ header: 'v1:0:1' })
    await waitFor(() => expect(frames).toHaveLength(4))
    expect(frames[0]?.id).toBe('v1:0:1')
    expect(frames[1]?.data).toMatchObject({ type: 'events', fromSeq: 2 })
  })

  it('resets disconnected same-head epochs without sending a historical SSE body', async () => {
    historyRev = 1
    events = [streamEvent(3)]
    const { frames } = subscribe({ lastEventId: 'v1:0:3' })
    await waitFor(() => expect(frames).toHaveLength(3))
    expect(frames[0]).toEqual({
      id: 'v1:1:3',
      data: { type: EThreadStreamFrame.Reset, head: 3, historyRev: 1 },
    })
    expect(frames.some((frame) => frame.data.type === EThreadStreamFrame.Events)).toBe(false)
    expect(read.mock.calls.every(([args]) => args.stateOnly === true)).toBe(true)
  })

  it('exposes atomic epoch-tagged seed and inclusive bounded fallback through the query', async () => {
    const seed = await fixture.queries.threadEvents.snapshot.query({ threadId: 'thr_1' })
    expect<ThreadEventsSnapshot>(seed).toEqual({ events, head: 3, historyRev: 0 })
    const suffix = await fixture.queries.threadEvents.snapshot.query({
      threadId: 'thr_1',
      fromSeq: 2,
    })
    expect<ThreadEventsSnapshot>(suffix).toEqual({
      events: [streamEvent(2), streamEvent(3)],
      head: 3,
      historyRev: 0,
    })
    await expect(
      fixture.queries.threadEvents.snapshot.query({ threadId: 'other' }),
    ).rejects.toThrow()
  })

  it('forbids sandbox tokens and isolates other owners before opening the stream', async () => {
    const forbidden = subscribe({ sandbox: true })
    await waitFor(() => expect(forbidden.failures).toHaveLength(1))
    expect(forbidden.failures[0]?.data?.httpStatus).toBe(403)
    const other = subscribe({ threadId: 'other' })
    await waitFor(() => expect(other.failures).toHaveLength(1))
    expect(other.failures[0]?.data?.httpStatus).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })
})
