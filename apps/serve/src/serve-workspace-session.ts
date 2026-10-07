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
  sourceSessionId?: string | undefined
  app: ServeApp
  capture?: WorkspaceCapturer | undefined
  dormant: boolean
  deferStartChildren?: boolean | undefined
  resumeChildren?: readonly ThreadId[] | undefined
  log: ServeLog
  settling: { count: number }
  note: () => void
}) {
  const { app, threadId, log, settling, note } = args
  const adoptingApp = {
    ...app,
    adoptChildren: (given: { threadId: ThreadId }) => app.adoptChildren({
      ...given, ...(args.resumeChildren === undefined ? {} : { resumeChildren: args.resumeChildren }),
    }),
  }
  let starting = Promise.resolve()
  let pendingStart: Promise<void> | null = null
  const startChildren = (): Promise<void> => {
    if (pendingStart !== null) return pendingStart
    starting = Promise.allSettled([
      settleLostShellsInBackground({ app, threadId, log, settling, note }),
      adoptChildrenNow({ app: adoptingApp, threadId, log, settling, note }),
    ]).then((results) => {
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
    const captured = starting
    pendingStart = captured
    const finished = (): void => { if (pendingStart === captured) pendingStart = null }
    void captured.then(finished, finished)
    return captured
  }
  const session = createWorkspaceSession({
    direct: args.direct,
    driveHome: args.driveHome,
    threadId,
    launchDirectory: () => args.direct.activeCwd() ?? args.activeCwd,
    app,
    capture: args.capture,
    dormant: args.dormant,
    sourceSessionId: args.sourceSessionId,
    startChildren,
  })
  if (!session.dormant() && args.deferStartChildren !== true) {
    void startChildren().catch((error: unknown) => {
      log({ event: EServeEvent.ChildAdoptionFailed, reason: error instanceof Error ? error.message : String(error) })
    })
  }
  return { ...session, startChildren, whenStarted: () => starting }
}
