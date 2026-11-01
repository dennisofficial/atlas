import {
  orphanedInputsOf,
  type ForkEvent,
  type OrphanedInput,
  type ThreadId,
} from '@dltech/atlas-core'

import { EServeEvent, type ServeLog } from './serve-log'

export type RedeliverInput = (input: OrphanedInput) => Promise<void>

export type ForkReconciler = {
  reconcile: (args: { forkSeq: number }) => Promise<void>
}

export function createForkReconciler(args: {
  threadId: ThreadId
  readRemoteTail: (args: { fromSeq: number }) => Promise<readonly ForkEvent[]>
  readLocal: () => Promise<readonly ForkEvent[]>
  redeliver: RedeliverInput
  log: ServeLog
}): ForkReconciler {
  const { threadId, log } = args
  return {
    reconcile: async ({ forkSeq }) => {
      const remote = await args.readRemoteTail({ fromSeq: forkSeq })
      const local = await args.readLocal()
      const { inputs, discarded } = orphanedInputsOf({ remote, local })
      for (const input of inputs) await args.redeliver(input)
      log({
        event: EServeEvent.EventForkReconciled,
        threadId,
        forkSeq,
        redelivered: inputs.length,
        discarded,
      })
    },
  }
}
