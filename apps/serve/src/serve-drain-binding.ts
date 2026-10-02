import type { ThreadId } from '@dltech/atlas-core'

import type { RuntimeCheckpointBinding } from './runtime-checkpoint-binding'
import type { ServeApp } from './serve-app'
import { createServeDrain, type ServeDrain } from './serve-drain'
import type { ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export function bindServeDrain(args: {
  app: ServeApp
  driver: ServeTurnDriver
  threadId: ThreadId
  admission: { closed: boolean }
  haltIdle: () => void
  checkpoint: Pick<RuntimeCheckpointBinding, 'finalizeRotation'>
  close: (given: { reason: string }) => Promise<void>
  exit: (code: number) => void
  log: ServeLog
}): ServeDrain {
  return createServeDrain({
    threadId: args.threadId,
    driver: args.driver,
    closeAdmission: () => {
      args.admission.closed = true
      args.haltIdle()
      args.app.intake?.suspend()
    },
    endProcesses: async ({ killedBy }) => args.app.endProcesses?.({ killedBy }),
    seal: args.checkpoint.finalizeRotation,
    retire: async ({ reason }) => {
      try {
        await args.close({ reason })
      } finally {
        args.exit(0)
      }
    },
    log: args.log,
  })
}
