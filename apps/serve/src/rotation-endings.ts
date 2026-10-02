import type { EKilledBy, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'
import type { ServiceRegistryPort, ShellRegistryPort, ThreadStorePort } from '@dltech/atlas-harness'

import { familyThreadIdsOf } from './workspace-hooks'

export function rotationEndingsFor(args: {
  root: ThreadId
  shells: Pick<ShellRegistryPort, 'closeAll' | 'drainNotifications'>
  services: Pick<ServiceRegistryPort, 'closeAll' | 'drainNotifications'>
  threads: Pick<ThreadStorePort, 'spawned'>
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
}): (given: { killedBy: EKilledBy }) => Promise<void> {
  return async ({ killedBy }) => {
    await Promise.all([args.shells.closeAll({ killedBy }), args.services.closeAll({ killedBy })])
    const family = await familyThreadIdsOf({ root: args.root, threads: args.threads })
    for (const threadId of family) {
      const drafts = [
        ...args.shells.drainNotifications({ threadId }),
        ...args.services.drainNotifications({ threadId }),
      ]
      if (drafts.length === 0) continue
      await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
    }
  }
}
