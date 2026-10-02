import type { ThreadId } from '@dltech/atlas-core'

import type { DirectWorkspace } from './direct-workspace'
import type { WorkspaceCapturer } from './prepare-workspace'
import type { ServeApp } from './serve-app'
import { adoptChildrenNow, settleLostShellsInBackground } from './serve-background'
import { EServeEvent, type ServeLog } from './serve-log'
import { createWorkspaceSession } from './workspace-session'

export function createServeWorkspaceSession(args: {
  direct: DirectWorkspace
  driveHome: string
  threadId: ThreadId
  activeCwd: string
  app: ServeApp
  capture?: WorkspaceCapturer | undefined
  dormant: boolean
  log: ServeLog
  settling: { count: number }
  note: () => void
}) {
  const { app, threadId, log, settling, note } = args
  const startChildren = async (): Promise<void> => {
    settleLostShellsInBackground({ app, threadId, log, settling, note })
    await adoptChildrenNow({ app, threadId, log, settling, note })
  }
  const session = createWorkspaceSession({
    direct: args.direct,
    driveHome: args.driveHome,
    threadId,
    launchDirectory: () => args.direct.activeCwd() ?? args.activeCwd,
    app,
    capture: args.capture,
    dormant: args.dormant,
    startChildren,
  })
  if (!session.dormant()) {
    void startChildren().catch((error: unknown) => {
      log({ event: EServeEvent.ChildAdoptionFailed, reason: error instanceof Error ? error.message : String(error) })
    })
  }
  return session
}
