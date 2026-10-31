import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import { readPodFrame, type ThreadPodSnapshot } from './pod-snapshot'
import type { ThreadFrameSink } from './thread-stream.frames'
import type { ThreadSignalsService } from './thread-signals.service'
import { readThreadMetadata, type ThreadMetadataFrame } from './thread-stream-state'

export const THREAD_STREAM_HEARTBEAT_INTERVAL_MS = 30_000
export const THREAD_STREAM_LIFETIME_MS = 240_000
export const THREAD_STREAM_BUFFER_LIMIT = 1000

const logger = new Logger('ThreadStream')

export function attachThreadStream(args: {
  signals: Pick<ThreadSignalsService, 'openStream' | 'awaitSubscription'>
  threadId: string
  readHead: () => Promise<number>
  readMetadata?: () => Promise<ThreadMetadataFrame>
  readPod?: () => Promise<ThreadPodSnapshot>
  sink: ThreadFrameSink
}): () => void {
  const { sink } = args
  const early: ThreadStreamFrame[] = []
  let ready = false
  let closed = false
  let podDirty = false
  let rev = -1
  let podRev = -1
  let closeStream = (): void => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined
  const close = (): void => {
    if (closed) return
    closed = true
    early.length = 0
    clearInterval(heartbeat)
    clearTimeout(lifetime)
    closeStream()
  }
  const handleClosed = (): void => {
    if (closed) return
    close()
    sink.close()
  }
  const emit = (frame: ThreadStreamFrame): void => {
    if (closed) return
    if (frame.type === EThreadStreamFrame.Meta) {
      if (frame.thread.id !== args.threadId || frame.rev <= rev) return
      rev = frame.rev
    }
    if (frame.type === EThreadStreamFrame.Pod && frame.rev !== undefined) {
      if (frame.rev <= podRev) return
      podRev = frame.rev
    }
    sink.push(frame)
  }
  const deliver = (frame: ThreadStreamFrame): void => {
    if (closed) return
    if (ready) return emit(frame)
    if (frame.type === EThreadStreamFrame.Pod && frame.rev === undefined) {
      podDirty = true
      return
    }
    early.push(frame)
    if (early.length > THREAD_STREAM_BUFFER_LIMIT) handleClosed()
  }

  closeStream = args.signals.openStream({
    threadId: args.threadId,
    onFrame: deliver,
    onClosed: handleClosed,
  })
  if (closed) {
    closeStream()
    return close
  }
  const readPod = args.readPod ?? (() => readPodFrame({ threadId: args.threadId }))
  const initialize = async (): Promise<void> => {
    await args.signals.awaitSubscription()
    if (closed) return
    podDirty = false
    const [head, metadata, initialPod] = await Promise.all([
      args.readHead(),
      args.readMetadata?.() ?? readThreadMetadata({ threadId: args.threadId }),
      readPod(),
    ])
    if (closed) return
    let pod = initialPod
    if (podDirty) {
      podDirty = false
      pod = await readPod()
      if (closed) return
    }
    emit({ type: EThreadStreamFrame.Head, head })
    emit(metadata)
    emit(pod)
    if (podDirty) emit({ type: EThreadStreamFrame.Pod })
    ready = true
    for (const frame of early.splice(0)) emit(frame)
  }
  void initialize().catch((failure: unknown) => {
    logger.warn(`reading the state of ${args.threadId} failed: ${String(failure)}`)
    handleClosed()
  })

  heartbeat = setInterval(
    () => deliver({ type: EThreadStreamFrame.Heartbeat }),
    THREAD_STREAM_HEARTBEAT_INTERVAL_MS,
  )
  lifetime = setTimeout(handleClosed, THREAD_STREAM_LIFETIME_MS)
  return close
}
