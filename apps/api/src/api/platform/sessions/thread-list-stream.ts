import { EThreadListFrame, type ThreadListFrame } from '@dltech/atlas-wire'
import { THREAD_STREAM_HEARTBEAT_INTERVAL_MS, THREAD_STREAM_LIFETIME_MS } from './thread-stream'
import type { ThreadSignalsService } from './thread-signals.service'

export function attachListStream(args: {
  signals: Pick<ThreadSignalsService, 'openListStream'>
  userId: string
  sink: { push: (frame: ThreadListFrame) => void; close: () => void }
}): () => void {
  const { sink } = args
  const closeStream = args.signals.openListStream({
    userId: args.userId,
    onFrame: sink.push,
    onClosed: sink.close,
  })
  const heartbeat = setInterval(
    () => sink.push({ type: EThreadListFrame.Heartbeat }),
    THREAD_STREAM_HEARTBEAT_INTERVAL_MS,
  )
  const lifetime = setTimeout(() => sink.close(), THREAD_STREAM_LIFETIME_MS)
  return () => {
    clearInterval(heartbeat)
    clearTimeout(lifetime)
    closeStream()
  }
}
