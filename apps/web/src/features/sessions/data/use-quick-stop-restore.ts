import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import type { Attachment } from '@dltech/atlas-core'
import { quickStopRestoresToApply, type QuickStopEvidence } from '@dltech/atlas-client/session'

import {
  handledQuickStopsOf,
  rememberHandledQuickStops,
  sentClientIdsOf,
  subscribeStaged,
} from './staged-store'

export function useQuickStopRestore(args: {
  sessionId: string
  quickStops: readonly QuickStopEvidence[]
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
}): void {
  const { sessionId, quickStops } = args
  const subscribe = useCallback(
    (listener: () => void) => subscribeStaged({ sessionId, listener }),
    [sessionId],
  )
  const getSnapshot = useCallback(() => sentClientIdsOf(sessionId), [sessionId])
  const sent = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const restore = useRef(args.onRestore)
  restore.current = args.onRestore

  useEffect(() => {
    const pending = quickStopRestoresToApply({
      quickStops,
      clientIds: sent,
      handled: handledQuickStopsOf(sessionId),
    })
    if (pending.length === 0) return
    rememberHandledQuickStops({
      sessionId,
      rewindEventIds: pending.map((entry) => entry.rewindEventId),
    })
    for (const entry of pending) {
      restore.current({ text: entry.text, attachments: entry.attachments })
    }
  }, [quickStops, sent, sessionId])
}
