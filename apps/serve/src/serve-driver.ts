import type { ThreadId } from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-harness'

import type { LifecycleFrame } from './frame-buffer'
import type { ServeIdleStop } from './idle-stop'
import { workspaceRefusalOf, type WorkspaceReadiness } from './materialize-workspace'
import type { ServeApp } from './serve-app'
import { DORMANT_REFUSAL, PARKING_REFUSAL, wireOutcomeOf } from './serve-outcome'
import { EServeEvent, type ServeLog } from './serve-log'
import { createTurnDriver } from './turn-driver'
import type { WorkspaceSession } from './workspace-session'

export function createServeDriver(args: {
  app: ServeApp
  threadId: ThreadId
  workspace: WorkspaceReadiness
  session: Pick<WorkspaceSession, 'dormant'>
  admission: { closed: boolean }
  log: ServeLog
  idleStop: () => Pick<ServeIdleStop, 'note'>
  emitLifecycle: (frame: LifecycleFrame) => void
}) {
  const { app, log } = args
  return createTurnDriver({
    app,
    threadId: args.threadId,
    refusal: () =>
      args.admission.closed
        ? PARKING_REFUSAL
        : (workspaceRefusalOf(args.workspace) ?? (args.session.dormant() ? DORMANT_REFUSAL : undefined)),
    onTurnStarted: () => {
      args.idleStop().note()
      log({ event: EServeEvent.TurnStarted })
    },
    onTurnEnded: () => {
      args.idleStop().note()
      app.files.forget()
    },
    onOutcome: (outcome) => {
      log({ event: EServeEvent.TurnEnded, status: outcome.status })
      args.emitLifecycle({ kind: EServeFrame.TurnEnded, outcome: wireOutcomeOf(outcome) })
    },
    onFailure: (reason) => {
      log({ event: EServeEvent.TurnFailed, reason })
      args.emitLifecycle({ kind: EServeFrame.Error, message: reason })
    },
  })
}
