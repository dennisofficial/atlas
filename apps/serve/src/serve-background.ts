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
  args.settling.count += 1
  const release = (): void => {
    args.settling.count -= 1
    args.note()
  }
  let resumed: readonly string[]
  try {
    resumed = await args.app.adoptChildren({ threadId: args.threadId })
  } catch (error) {
    release()
    throw error
  }
  if (resumed.length === 0) {
    release()
    return
  }

  args.log({ event: EServeEvent.ChildrenAdopted, agentIds: resumed })
  args.note()
  void args.app
    .whenChildrenSettled({ threadId: args.threadId })
    .catch((error: unknown) => {
      args.log({ event: EServeEvent.ChildAdoptionFailed, reason: messageOf(error) })
    })
    .finally(release)
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
  settling: { count: number }
  note: () => void
}): Promise<void> {
  const work: Promise<void>[] = []
  const settleWith = <T>(args2: {
    recover: ((args: { threadId: ThreadId }) => Promise<readonly T[]>) | undefined
    detail: (settled: readonly T[]) => Record<string, unknown>
  }): void => {
    if (args2.recover === undefined) return
    args.settling.count += 1
    const recovering = args2
      .recover({ threadId: args.threadId })
      .then((settled) => {
        if (settled.length > 0) args.log({ event: EServeEvent.LostShellsSettled, ...args2.detail(settled) })
      })
      .catch((error: unknown) => {
        args.log({ event: EServeEvent.LostShellSettlementFailed, reason: messageOf(error) })
        throw error
      })
      .finally(() => {
        args.settling.count -= 1
        args.note()
      })
    work.push(recovering)
  }

  settleWith({
    recover: args.app.recordLostShells,
    detail: (settled) => ({ shellIds: settled.map((shell) => shell.shellId) }),
  })
  settleWith({
    recover: args.app.recordLostServices,
    detail: (settled) => ({ serviceIds: settled.map((service) => service.serviceId) }),
  })
  return Promise.allSettled(work).then((results) => {
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  })
}
