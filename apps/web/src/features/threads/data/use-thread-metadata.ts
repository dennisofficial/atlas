import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { ThreadSignalHub } from './thread-signal-hub'

export function useThreadMetadata(args: { threadId: string; signals: ThreadSignalHub }) {
  const { threadId, signals } = args
  const client = useQueryClient()
  const held = useRef({ threadId, rev: -1 })

  useEffect(() => {
    if (held.current.threadId !== threadId) held.current = { threadId, rev: -1 }
    let active = true
    const unlisten = signals.listen({
      onMeta: async ({ thread, rev }) => {
        if (!active || thread.id !== threadId || rev <= held.current.rev) return
        held.current.rev = rev
        const queryKey = [`thread:${threadId}`]
        await client.cancelQueries({ queryKey, exact: true })
        if (!active || rev !== held.current.rev) return
        client.setQueryData(queryKey, { value: thread })
      },
    })
    return () => {
      active = false
      unlisten()
    }
  }, [threadId, signals, client])
}
