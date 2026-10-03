import { EKilledBy, isTeammateType, type ThreadId } from '@dltech/atlas-core'

import { KILL_SETTLE_MS, type ShellRegistryPort } from '../shells/shell-registry'
import type { ThreadStorePort } from '../store/thread-store'

export async function stopMovingShells(args: {
  root: ThreadId
  threads: Pick<ThreadStorePort, 'spawned'>
  shells: ShellRegistryPort
}): Promise<number> {
  const owners = new Set<ThreadId>([args.root])
  for (const threadId of owners) {
    for (const child of await args.threads.spawned({ threadId })) {
      if (child.agent !== undefined && isTeammateType(child.agent.type)) continue
      owners.add(child.id)
    }
  }

  const stopped = await args.shells.stopOwners({
    threadIds: [...owners],
    by: EKilledBy.ContainerSwitch,
    ms: KILL_SETTLE_MS,
  })
  return stopped.length
}
