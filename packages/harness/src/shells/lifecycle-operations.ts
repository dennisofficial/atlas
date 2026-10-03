import { EShellStatus, type EKilledBy, type ThreadId } from '@dltech/atlas-core'

import type { ShellSnapshot } from './background-shell'
import type { ShellRegistryPort } from './port'

export type StopShellOwners = {
  threadIds: readonly ThreadId[]
  by: EKilledBy
  ms: number
}

export async function stopShellOwners(args: {
  shells: Pick<ShellRegistryPort, 'reconcile' | 'list' | 'kill' | 'awaitEndings'>
  owners: StopShellOwners
}): Promise<readonly ShellSnapshot[]> {
  const { shells, owners } = args
  const threadIds = [...new Set(owners.threadIds)]
  await Promise.all(threadIds.map((threadId) => shells.reconcile({ threadId, ownOnly: true })))
  const running = threadIds.flatMap((threadId) =>
    shells.list({ threadId }).filter((shell) => shell.status === EShellStatus.Running),
  )
  for (const shell of running) {
    const killed = shells.kill({ threadId: shell.threadId, shellId: shell.shellId, by: owners.by })
    if (!killed.ok) throw new Error(killed.reason)
  }
  const stragglers = await Promise.all(threadIds.map((threadId) =>
    shells.awaitEndings({ threadId, ms: owners.ms }),
  ))
  const live = threadIds.some((threadId) =>
    shells.list({ threadId }).some((shell) => shell.status === EShellStatus.Running),
  )
  if (live || stragglers.some((count) => count > 0)) {
    throw new Error('background shells have not stopped, so their execution location cannot change')
  }
  return running
}
