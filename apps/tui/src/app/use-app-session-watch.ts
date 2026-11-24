import { useState } from 'react'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { ENoticeTone, notify } from '../ui/notice-store'
import { newClientId, usePresenceReport } from './presence'
import type { SessionApi } from './session-api'
import { useSessionNotices } from './use-session-notices'

export function useAppSessionWatch(args: {
  api: SessionApi | null
  sessionId: string | null
}): (rows: readonly StreamSessionRow[]) => void {
  const [clientId] = useState(newClientId)

  usePresenceReport({ api: args.api, sessionId: args.sessionId, clientId })
  return useSessionNotices({
    watching: args.sessionId,
    onNotice: (notice) => notify({ text: notice.text, tone: ENoticeTone.Done, key: notice.key }),
  })
}
