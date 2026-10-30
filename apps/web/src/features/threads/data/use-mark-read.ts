import { useEffect, useRef } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createMarkReadScheduler, type MarkReadScheduler } from './mark-read-scheduler'
import type { ThreadSignalHub } from './thread-signal-hub'
import { useThreadBackend } from './use-thread-backend'

export function useMarkRead(args: {
  threadId: string
  signals: ThreadSignalHub
  head: number | undefined
}) {
  const { threadId, signals, head } = args
  const { markRead } = useThreadBackend()
  const visible = usePageVisible()
  const scheduler = useRef<MarkReadScheduler | undefined>(undefined)

  useEffect(() => {
    if (!visible) return undefined
    const created = createMarkReadScheduler({
      send: (seq) => markRead({ threadId, seq }),
    })
    scheduler.current = created
    const stopListening = signals.listen({ onHead: created.push })
    return () => {
      stopListening()
      created.stop()
      scheduler.current = undefined
    }
  }, [threadId, signals, visible, markRead])

  useEffect(() => {
    if (head !== undefined) scheduler.current?.push(head)
  }, [head, threadId, visible])
}
