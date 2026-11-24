import {
  mergedDraftOf,
  quickStopRestoresToApply,
  type QuickStopEvidence,
} from '@dltech/atlas-client/session'
import { useEffect, useRef } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import { handledQuickStopsOf, rememberHandledQuickStops, sentClientIds } from './sent-client-ids'
import type { SessionAttachments } from './use-session-attachments'

export function useQuickStopRestore(args: {
  sessionId: string
  quickStops: readonly QuickStopEvidence[]
  draft: Pick<DraftControls, 'value' | 'setValue'> & { editor: DraftControls['editor'] }
  attachments: Pick<SessionAttachments, 'restore'>
}): void {
  const latest = useRef(args)
  latest.current = args

  useEffect(() => {
    const pending = quickStopRestoresToApply({
      quickStops: args.quickStops,
      clientIds: sentClientIds(),
      handled: handledQuickStopsOf(args.sessionId),
    })
    if (pending.length === 0) return
    rememberHandledQuickStops({
      sessionId: args.sessionId,
      rewindEventIds: pending.map((entry) => entry.rewindEventId),
    })
    for (const entry of pending) {
      const { draft } = latest.current
      const current = draft.editor.current?.plainText ?? draft.value
      draft.setValue(mergedDraftOf({ rewound: entry.text, current }))
      latest.current.attachments.restore(entry.attachments)
    }
  }, [args.quickStops, args.sessionId])
}
