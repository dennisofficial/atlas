import { useEffect } from 'react'

import type { LiveSend } from './live-thread-view'
import type { ThreadBackend } from './thread-backend'

export function useAfterConnect(args: {
  live: boolean
  threadId: string
  afterConnect: ThreadBackend['afterConnect']
  send: LiveSend
}) {
  const { live, threadId, afterConnect, send } = args
  useEffect(() => {
    if (live) afterConnect({ threadId, send })
  }, [live, afterConnect, threadId, send])
}
