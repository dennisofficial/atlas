import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '@dltech/atlas-harness'

import type { DirectWorkspace } from './direct-workspace'
import type { ServeApp } from './serve-app'

const locationOf = (value: string | undefined, fallback: EExecutionLocation): EExecutionLocation =>
  Object.values(EExecutionLocation).find((candidate) => candidate === value) ?? fallback

export async function settleDirectArrival(args: {
  direct: DirectWorkspace
  app: Pick<ServeApp, 'log' | 'recordWorkspaceArrival'>
  threadId: ThreadId
  restored: RestoredWorkspace
  launchDirectory: string
  from?: string | undefined
  to?: string | undefined
}): Promise<boolean> {
  const events = await args.app.log.read({ threadId: args.threadId })
  if (events.length === 0 || args.app.recordWorkspaceArrival === undefined) return false
  await args.app.recordWorkspaceArrival({
    from: locationOf(args.from, EExecutionLocation.Host),
    to: locationOf(args.to, EExecutionLocation.Cloud),
    restored: args.restored,
    launchDirectory: args.launchDirectory,
  })
  await args.direct.markArrived()
  return true
}
