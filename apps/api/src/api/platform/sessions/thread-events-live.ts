import {
  EThreadStreamFrame,
  type ThreadEventsSnapshot,
  type ThreadStreamFrame,
} from '@dltech/atlas-wire'
import { encodeThreadEventCursor } from './thread-event-cursor'
import { ThreadEventOrder } from './thread-event-order'
import type { EventSnapshotReader } from './thread-events-snapshot'
import type { ThreadSignalsService } from './thread-signals.service'
import { attachThreadStream, THREAD_STREAM_BUFFER_LIMIT } from './thread-stream'
import { threadStreamFrames } from './thread-stream.frames'
import type { ThreadMetadataFrame } from './thread-stream-state'
import type { ThreadPodSnapshot } from './pod-snapshot'

const { tracked }: Pick<typeof import('@trpc/server'), 'tracked'> = require('@trpc/server')

export async function* orderedThreadEvents(args: {
  threadId: string
  lastEventId: string | undefined
  signal: AbortSignal | undefined
  signals: Pick<ThreadSignalsService, 'openStream' | 'awaitSubscription'>
  readSnapshot: EventSnapshotReader
  readMetadata?: () => Promise<ThreadMetadataFrame>
  readPod?: () => Promise<ThreadPodSnapshot>
}) {
  const order = new ThreadEventOrder(args.readSnapshot)
  let initial: ThreadEventsSnapshot | undefined
  let stopped = false
  let checkpoint = ''
  const source = threadStreamFrames({
    signal: args.signal,
    queueLimit: THREAD_STREAM_BUFFER_LIMIT,
    onOverflow: () => {
      stopped = true
    },
    attach: (sink) =>
      attachThreadStream({
        threadId: args.threadId,
        signals: {
          openStream: (options) =>
            args.signals.openStream({
              ...options,
              onFrame: (frame) => {
                order.observe(frame)
                options.onFrame(frame)
              },
            }),
          awaitSubscription: () => args.signals.awaitSubscription(),
        },
        readHead: async () => {
          initial = await args.readSnapshot({ stateOnly: true })
          return initial.head
        },
        ...(args.readMetadata === undefined ? {} : { readMetadata: args.readMetadata }),
        ...(args.readPod === undefined ? {} : { readPod: args.readPod }),
        sink: {
          push: sink.push,
          close: () => {
            stopped = true
            sink.close()
          },
        },
      }),
  })
  const canDeliver = (frame: ThreadStreamFrame | undefined): frame is ThreadStreamFrame =>
    frame !== undefined && order.isCurrent(frame) && !stopped && args.signal?.aborted !== true
  const emit = (frame: ThreadStreamFrame) => {
    checkpoint = encodeThreadEventCursor(order.cursor)
    return tracked(checkpoint, frame)
  }
  for await (const raw of source) {
    if (stopped || args.signal?.aborted === true) return
    if (checkpoint === '') {
      if (initial === undefined) return
      const frame = await order.open({ snapshot: initial, lastEventId: args.lastEventId })
      if (!canDeliver(frame)) return
      yield emit(frame)
      if (frame.type === EThreadStreamFrame.Head && frame.head > order.cursor.seq) {
        const suffix = await order.catchUp()
        if (canDeliver(suffix)) yield emit(suffix)
      }
      continue
    }
    const frame = await order.accept(raw)
    if (!canDeliver(frame)) continue
    if (frame.type === EThreadStreamFrame.Events || frame.type === EThreadStreamFrame.Reset) {
      yield emit(frame)
      continue
    }
    yield tracked(checkpoint, frame)
  }
}
