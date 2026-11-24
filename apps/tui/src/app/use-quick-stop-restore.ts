import type { V2Event } from '@dltech/atlas-core'
import { mergedDraftOf, quickStopRestoresToApply } from '@dltech/atlas-client/session'
import { useEffect, useRef } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import { sentClientIds } from './sent-client-ids'
import type { SessionAttachments } from './use-session-attachments'

export function useQuickStopRestore(args: {
  rawEvents: readonly V2Event[]
  draft: Pick<DraftControls, 'value' | 'setValue'> & { editor: DraftControls['editor'] }
  attachments: Pick<SessionAttachments, 'restore'>
}): void {
  const handled = useRef<ReadonlySet<string>>(new Set())
  const latest = useRef(args)
  latest.current = args

  useEffect(() => {
    const pending = quickStopRestoresToApply({
      events: args.rawEvents,
      clientIds: sentClientIds(),
      handled: handled.current,
    })
    if (pending.length === 0) return
    handled.current = new Set([...handled.current, ...pending.map((entry) => entry.rewindEventId)])
    for (const entry of pending) {
      const { draft } = latest.current
      const current = draft.editor.current?.plainText ?? draft.value
      draft.setValue(mergedDraftOf({ rewound: entry.text, current }))
      latest.current.attachments.restore(entry.attachments)
    }
  }, [args.rawEvents])
}
