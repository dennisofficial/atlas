import type { ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function adoptChildrenInBackground(args: {
  app: Pick<ServeApp, 'adoptChildren' | 'whenChildrenSettled'>
  threadId: ThreadId
  log: ServeLog
  settling: { count: number }
  note: () => void
}): void {
  args.settling.count += 1
  void (async () => {
    try {
      const resumed = await args.app.adoptChildren({ threadId: args.threadId })
      if (resumed.length === 0) return
      args.log({ event: EServeEvent.ChildrenAdopted, agentIds: resumed })
      args.note()
      await args.app.whenChildrenSettled({ threadId: args.threadId })
    } finally {
      args.settling.count -= 1
      args.note()
    }
  })().catch((error: unknown) => {
    args.log({ event: EServeEvent.ChildAdoptionFailed, reason: messageOf(error) })
  })
}

export function settleLostShellsInBackground(args: {
  app: Pick<ServeApp, 'recordLostShells' | 'recordLostServices'>
  threadId: ThreadId
  log: ServeLog
  settling: { count: number }
  note: () => void
}): void {
  for (const recover of [args.app.recordLostShells, args.app.recordLostServices]) {
    if (recover === undefined) continue
    args.settling.count += 1
    void recover({ threadId: args.threadId })
      .then((settled) => {
        if (settled.length > 0) args.log({ event: EServeEvent.LostShellsSettled, count: settled.length })
      })
      .catch((error: unknown) => {
        args.log({ event: EServeEvent.LostShellSettlementFailed, reason: messageOf(error) })
      })
      .finally(() => {
        args.settling.count -= 1
        args.note()
      })
  }
}
