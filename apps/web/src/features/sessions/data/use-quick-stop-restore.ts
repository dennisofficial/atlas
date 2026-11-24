import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import type { Attachment, V2Event } from '@dltech/atlas-core'
import { quickStopRestoresToApply } from '@dltech/atlas-client/session'

import { sentClientIdsOf, subscribeStaged } from './staged-store'

export function useQuickStopRestore(args: {
  sessionId: string
  events: readonly V2Event[]
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
}): void {
  const { sessionId, events } = args
  const subscribe = useCallback(
    (listener: () => void) => subscribeStaged({ sessionId, listener }),
    [sessionId],
  )
  const getSnapshot = useCallback(() => sentClientIdsOf(sessionId), [sessionId])
  const sent = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const handled = useRef<ReadonlySet<string>>(new Set())
  const restore = useRef(args.onRestore)
  restore.current = args.onRestore

  useEffect(() => {
    const pending = quickStopRestoresToApply({ events, clientIds: sent, handled: handled.current })
    if (pending.length === 0) return
    handled.current = new Set([...handled.current, ...pending.map((entry) => entry.rewindEventId)])
    for (const entry of pending) {
      restore.current({ text: entry.text, attachments: entry.attachments })
    }
  }, [events, sent])
}
