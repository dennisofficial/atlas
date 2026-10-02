import type { ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'child adoption failed for a reason it did not name'

export async function adoptChildrenNow(args: {
  app: Pick<ServeApp, 'adoptChildren' | 'whenChildrenSettled'>
  threadId: ThreadId
  log: ServeLog
  settling: { count: number }
  note: () => void
}): Promise<void> {
  const resumed = await args.app.adoptChildren({ threadId: args.threadId })
  if (resumed.length === 0) return

  args.log({ event: EServeEvent.ChildrenAdopted, agentIds: resumed })
  args.settling.count += 1
  args.note()
  void args.app
    .whenChildrenSettled({ threadId: args.threadId })
    .catch((error: unknown) => {
      args.log({ event: EServeEvent.ChildAdoptionFailed, reason: messageOf(error) })
    })
    .finally(() => {
      args.settling.count -= 1
      args.note()
    })
}

export function adoptChildrenInBackground(args: Parameters<typeof adoptChildrenNow>[0]): void {
  void adoptChildrenNow(args).catch((error: unknown) => {
    args.log({ event: EServeEvent.ChildAdoptionFailed, reason: messageOf(error) })
  })
}

export function settleLostShellsInBackground(args: {
  app: Pick<ServeApp, 'recordLostShells' | 'recordLostServices'>
  threadId: ThreadId
  log: ServeLog
}): void {
  if (args.app.recordLostShells !== undefined) {
    void args.app
      .recordLostShells({ threadId: args.threadId })
      .then((settled) => {
        if (settled.length > 0) {
          args.log({ event: EServeEvent.LostShellsSettled, shellIds: settled.map((shell) => shell.shellId) })
        }
      })
      .catch((error: unknown) => {
        args.log({ event: EServeEvent.LostShellSettlementFailed, reason: messageOf(error) })
      })
  }

  if (args.app.recordLostServices === undefined) return
  void args.app
    .recordLostServices({ threadId: args.threadId })
    .then((settled) => {
      if (settled.length > 0) {
        args.log({
          event: EServeEvent.LostShellsSettled,
          serviceIds: settled.map((service) => service.serviceId),
        })
      }
    })
    .catch((error: unknown) => {
      args.log({ event: EServeEvent.LostShellSettlementFailed, reason: messageOf(error) })
    })
}
