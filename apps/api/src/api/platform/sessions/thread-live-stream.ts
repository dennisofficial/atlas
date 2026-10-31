import { EThreadLiveFrame, wireThreadSchema, type ThreadLiveFrame } from '@dltech/atlas-wire'
import {
  isProjectChangedSignal,
  isProjectRemovedSignal,
  isThreadChangedSignal,
} from './thread-signal.bus'
import { Logger } from '@nestjs/common'
import type { ThreadFrameSink } from './thread-stream.frames'
import type { LiveSnapshot } from './live-snapshot'
import { THREAD_STREAM_HEARTBEAT_INTERVAL_MS, THREAD_STREAM_LIFETIME_MS } from './thread-stream'
import type { LiveSignal, ThreadSignalsService } from './thread-signals.service'

const logger = new Logger('ThreadLiveStream')

const BUFFER_LIMIT = 1000

export function attachLiveStream(args: {
  signals: Pick<ThreadSignalsService, 'watchLive' | 'awaitSubscription'>
  userId: string
  readSnapshot: () => Promise<LiveSnapshot>
  sink: ThreadFrameSink<ThreadLiveFrame>
}): () => void {
  const { sink } = args
  const buffered: LiveSignal[] = []
  let snapshotRows: Map<string, number> | undefined
  let closed = false
  let closeWatch = (): void => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined
  const close = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(lifetime)
    closeWatch()
  }
  const handleClosed = (): void => {
    if (closed) return
    close()
    sink.close()
  }

  closeWatch = args.signals.watchLive({
    userId: args.userId,
    onSignal: (signal) => {
      if (closed) return
      if (snapshotRows === undefined) {
        buffered.push(signal)
        if (buffered.length > BUFFER_LIMIT) {
          sink.push({ type: EThreadLiveFrame.Resync, reason: 'overflow' })
          sink.close()
          close()
        }
        return
      }
      deliver({ signal, snapshotRows, sink })
    },
    onClosed: handleClosed,
  })

  if (closed) {
    closeWatch()
    return close
  }

  args.signals
    .awaitSubscription()
    .then(() => (closed ? undefined : args.readSnapshot()))
    .then((snapshot) => {
      if (closed || snapshot === undefined) return
      snapshotRows = new Map(snapshot.rows.map((row) => [row.thread.id, row.rev]))
      sink.push({
        type: EThreadLiveFrame.Snapshot,
        rows: snapshot.rows,
        projects: snapshot.projects,
      })
      for (const signal of buffered.splice(0)) deliver({ signal, snapshotRows, sink })
    })
    .catch((failure: unknown) => {
      logger.warn(`reading the live snapshot of ${args.userId} failed: ${String(failure)}`)
      handleClosed()
    })

  heartbeat = setInterval(() => {
    if (!closed) sink.push({ type: EThreadLiveFrame.Heartbeat })
  }, THREAD_STREAM_HEARTBEAT_INTERVAL_MS)
  lifetime = setTimeout(handleClosed, THREAD_STREAM_LIFETIME_MS)

  return close
}

function deliver(args: {
  signal: LiveSignal
  snapshotRows: Map<string, number>
  sink: ThreadFrameSink<ThreadLiveFrame>
}): void {
  const { signal, sink } = args
  if (isProjectChangedSignal(signal)) {
    sink.push({ type: EThreadLiveFrame.ProjectUpsert, project: signal.project })
    return
  }
  if (isProjectRemovedSignal(signal)) {
    sink.push({ type: EThreadLiveFrame.ProjectRemove, projectId: signal.projectId })
    return
  }
  if (!isThreadChangedSignal(signal)) return
  if (signal.session.mainThreadId !== signal.threadId) return
  const held = args.snapshotRows.get(signal.threadId)
  if (held !== undefined && signal.rev <= held) return
  args.snapshotRows.set(signal.threadId, signal.rev)
  sink.push({
    type: EThreadLiveFrame.Upsert,
    row: {
      sessionId: signal.session.id,
      projectId: signal.session.projectId,
      managedBySessionId: signal.session.managedBySessionId,
      sortAt: signal.session.updatedAt,
      rev: signal.rev,
      thread: wireThreadSchema.parse(signal.thread),
    },
  })
}
