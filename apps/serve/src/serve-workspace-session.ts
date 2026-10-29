import type { ThreadId } from '@dltech/atlas-core'
import { settleCrashedCalls, type ToolEffectResolver } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'
import {
  adoptChildrenNow,
  resumeDeclaredServicesNow,
  settleLostShellsInBackground,
} from './serve-background'
import { EServeEvent, type ServeLog } from './serve-log'

export function createServeWorkspaceSession(args: {
  threadId: ThreadId
  app: ServeApp
  toolEffect?: ToolEffectResolver | undefined
  deferStartChildren?: boolean | undefined
  resumeChildren?: readonly ThreadId[] | undefined
  log: ServeLog
  settling: { count: number }
  note: () => void
}) {
  const { app, threadId, log, settling, note } = args
  const adoptingApp = {
    ...app,
    adoptChildren: (given: { threadId: ThreadId }) =>
      app.adoptChildren({
        ...given,
        ...(args.resumeChildren === undefined ? {} : { resumeChildren: args.resumeChildren }),
      }),
  }
  let starting = Promise.resolve()
  let pendingStart: Promise<void> | null = null
  const startChildren = (): Promise<void> => {
    if (pendingStart !== null) return pendingStart
    const toolEffect = args.toolEffect
    const settledCrashes =
      toolEffect === undefined
        ? Promise.resolve()
        : settleCrashedCalls({ log: app.log, ids: app.ids, threadId, effectOf: toolEffect })
    starting = settledCrashes
      .then(async () => {
        const lost = await Promise.allSettled([
          settleLostShellsInBackground({ app, threadId, log, settling, note }),
        ])
        await resumeDeclaredServicesNow({ app, threadId, log })
        const adopted = await Promise.allSettled([
          adoptChildrenNow({ app: adoptingApp, threadId, log, settling, note }),
        ])
        return [...lost, ...adopted]
      })
      .then((results) => {
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })
    const captured = starting
    pendingStart = captured
    const finished = (): void => {
      if (pendingStart === captured) pendingStart = null
    }
    void captured.then(finished, finished)
    return captured
  }
  if (args.deferStartChildren !== true) {
    void startChildren().catch((error: unknown) => {
      log({
        event: EServeEvent.ChildAdoptionFailed,
        reason: error instanceof Error ? error.message : String(error),
      })
    })
  }
  return { startChildren, whenStarted: () => starting }
}
