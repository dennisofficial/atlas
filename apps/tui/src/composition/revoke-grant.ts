import type { ThreadId } from '@dltech/atlas-core'
import { useCallback } from 'react'

import { ENoticeTone, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'

export function useRevokeGrant(args: {
  app: AtlasApp
  threadId: ThreadId
  refresh: () => Promise<void>
}): (grantId: string) => void {
  const { app, threadId, refresh } = args

  return useCallback(
    (grantId: string) => {
      void (async () => {
        await app.log.append({
          threadId,
          runId: app.ids.nextRunId(),
          drafts: [{ type: 'permission-revoked', grantId }],
        })
        await refresh()
      })().catch((error: unknown) => {
        notify({
          key: 'grant-revoke',
          tone: ENoticeTone.Warn,
          text: `the grant could not be revoked — ${messageOf(error)}`,
        })
      })
    },
    [app, refresh, threadId],
  )
}
