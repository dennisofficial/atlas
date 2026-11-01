import {
  orphanedInputsOf,
  type ForkEvent,
  type OrphanedInput,
  type ThreadId,
} from '@dltech/atlas-core'

import { EForkResolution, RedeliveryDeferred } from './serve-fork-resolution'
import { EServeEvent, type ServeLog } from './serve-log'

export type RedeliverInput = (input: OrphanedInput) => Promise<void>

export type ForkReconciler = {
  reconcile: (args: { forkSeq: number }) => Promise<EForkResolution>
}

export function createForkReconciler(args: {
  threadId: ThreadId
  readRemoteTail: (args: { fromSeq: number }) => Promise<readonly ForkEvent[]>
  readLocal: () => Promise<readonly ForkEvent[]>
  canRedeliverNow: () => boolean
  redeliver: RedeliverInput
  log: ServeLog
}): ForkReconciler {
  const { threadId, log } = args

  const redeliverAll = async (inputs: readonly OrphanedInput[]): Promise<EForkResolution> => {
    try {
      for (const input of inputs) await args.redeliver(input)
      return EForkResolution.Resolved
    } catch (failure) {
      if (failure instanceof RedeliveryDeferred) return EForkResolution.Deferred
      throw failure
    }
  }

  return {
    reconcile: async ({ forkSeq }) => {
      const remote = await args.readRemoteTail({ fromSeq: forkSeq })
      const local = await args.readLocal()
      const { inputs, discarded } = orphanedInputsOf({ remote, local })
      if (inputs.length > 0 && !args.canRedeliverNow()) return EForkResolution.Deferred
      const resolution = await redeliverAll(inputs)
      if (resolution === EForkResolution.Resolved) {
        log({
          event: EServeEvent.EventForkReconciled,
          threadId,
          forkSeq,
          redelivered: inputs.length,
          discarded,
        })
      }
      return resolution
    },
  }
}
