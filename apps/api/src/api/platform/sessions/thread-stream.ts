import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import type { ThreadFrameSink } from './thread-stream.frames'
import type { ThreadSignalsService } from './thread-signals.service'

export const THREAD_STREAM_HEARTBEAT_INTERVAL_MS = 30_000
export const THREAD_STREAM_LIFETIME_MS = 240_000

const logger = new Logger('ThreadStream')

export function attachThreadStream(args: {
  signals: ThreadSignalsService
  threadId: string
  readHead: () => Promise<number>
  sink: ThreadFrameSink
}): () => void {
  const { sink } = args
  const early: ThreadStreamFrame[] = []
  let ready = false
  const deliver = (frame: ThreadStreamFrame): void => {
    if (ready) sink.push(frame)
    else early.push(frame)
  }

  const closeStream = args.signals.openStream({
    threadId: args.threadId,
    onFrame: deliver,
    onClosed: () => sink.close(),
  })
  args
    .readHead()
    .then((head) => {
      sink.push({ type: EThreadStreamFrame.Head, head })
      ready = true
      for (const frame of early.splice(0)) sink.push(frame)
    })
    .catch((failure: unknown) => {
      logger.warn(`reading the head of ${args.threadId} failed: ${String(failure)}`)
      sink.close()
    })

  const heartbeat = setInterval(
    () => deliver({ type: EThreadStreamFrame.Heartbeat }),
    THREAD_STREAM_HEARTBEAT_INTERVAL_MS,
  )
  const lifetime = setTimeout(() => sink.close(), THREAD_STREAM_LIFETIME_MS)

  return () => {
    clearInterval(heartbeat)
    clearTimeout(lifetime)
    closeStream()
  }
}
