import type { ThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '@dltech/atlas-harness'

import type { DirectWorkspace } from './direct-workspace'
import type { ServeApp } from './serve-app'

export async function settleDirectArrival(args: {
  direct: DirectWorkspace
  app: Pick<ServeApp, 'log' | 'recordWorkspaceArrival'>
  threadId: ThreadId
  restored: RestoredWorkspace
  launchDirectory: string
}): Promise<boolean> {
  const events = await args.app.log.read({ threadId: args.threadId })
  if (events.length === 0 || args.app.recordWorkspaceArrival === undefined) return false
  await args.app.recordWorkspaceArrival({
    restored: args.restored,
    launchDirectory: args.launchDirectory,
  })
  await args.direct.markArrived()
  return true
}
