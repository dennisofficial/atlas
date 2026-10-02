import { MainWake as LegacyWake } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'

export function subscribeLegacyWake(args: {
  app: Pick<ServeApp, 'intake' | 'wakeNotices'>
  threadId: ThreadId
  running: () => boolean
  onWake: () => void
}): (() => void) | undefined {
  const { app, threadId } = args
  if (app.intake !== undefined || app.wakeNotices === undefined) return undefined
  const notices = app.wakeNotices
  const wake = new LegacyWake({ blocked: args.running, onWake: args.onWake })
  return notices.subscribe(() => {
    const waiting =
      notices.pendingShells({ threadId }) +
      notices.pendingAgents({ threadId }) +
      notices.pendingServices({ threadId })
    wake.onNotice({ witness: waiting > 0 ? `pending:${waiting}` : null })
  })
}
