import type { ThreadId } from '@dltech/atlas-core'
import { flushSessionInput, persistSandboxRotationIntent, persistSandboxRotationReceipt, readSandboxRotationState } from '@dltech/atlas-harness'
import { sandboxRotationReceiptSchema } from '@dltech/atlas-wire'

import type { RuntimeCheckpointBinding } from './runtime-checkpoint-binding'
import type { ServeApp } from './serve-app'
import { createServeDrain, type ServeDrain } from './serve-drain'
import type { ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export function bindServeDrain(args: {
  app: ServeApp
  driver: ServeTurnDriver
  threadId: ThreadId
  atlasHome: string
  sandboxSessionId: string
  admission: { closed: boolean }
  haltIdle: () => void
  whenMutationsSettled: () => Promise<void>
  checkpoint: Pick<RuntimeCheckpointBinding, 'finalizeRotation' | 'current'>
  close: (given: { reason: string }) => Promise<void>
  exit: (code: number) => void
  log: ServeLog
}): ServeDrain {
  let pendingParent = false
  let previousIntent = false
  const resumeChildren = new Set<string>()
  const persistIntent = async (): Promise<void> => {
    const pending = args.app.intake?.threadsWithPendingInput() ?? args.app.pending?.threadsAwaitingInput() ?? []
    pendingParent ||= pending.includes(args.threadId)
    for (const threadId of pending) if (threadId !== args.threadId) resumeChildren.add(threadId)
    await persistSandboxRotationIntent({
      atlasHome: args.atlasHome,
      threadId: args.threadId,
      sandboxSessionId: args.sandboxSessionId,
      resumeParent: previousIntent || pendingParent || args.driver.busy(),
      resumeChildren: [...resumeChildren],
    })
  }
  return createServeDrain({
    threadId: args.threadId,
    driver: args.driver,
    closeAdmission: () => {
      args.admission.closed = true
      args.haltIdle()
      args.app.intake?.suspend()
    },
    reopenAdmission: () => {
      args.admission.closed = false
      args.app.intake?.resume()
    },
    beginPreparation: async () => {
      await args.whenMutationsSettled()
      const prior = await readSandboxRotationState({ atlasHome: args.atlasHome })
      previousIntent ||= (prior !== null && prior.sandboxSessionId === args.sandboxSessionId && prior.resumeParent) || args.driver.busy()
      if (prior?.sandboxSessionId === args.sandboxSessionId) {
        for (const threadId of prior.resumeChildren ?? []) resumeChildren.add(threadId)
      }
      await persistIntent()
    },
    endProcesses: async ({ killedBy }) => {
      if (args.app.endProcesses !== undefined) return args.app.endProcesses({ killedBy })
      if ((args.app.runningShells?.() ?? 0) > 0 || (args.app.runningServices?.() ?? 0) > 0) {
        throw new Error('this runtime cannot stop its processes for relocation')
      }
    },
    flushInput: async () => {
      await persistIntent()
      if (args.app.intake !== undefined) {
        const written = await flushSessionInput({ intake: args.app.intake, log: args.app.log, ids: args.app.ids })
        pendingParent ||= written.includes(args.threadId)
      }
      if ((args.app.pending?.waitingCount() ?? 0) > 0) {
        throw new Error('queued input has not been persisted — nothing was destroyed')
      }
    },
    seal: async ({ resumeParent }) => {
      await args.checkpoint.finalizeRotation()
      const receipt = sandboxRotationReceiptSchema.parse({
        version: 1,
        threadId: args.threadId,
        sandboxSessionId: args.sandboxSessionId,
        resumeParent: resumeParent || previousIntent || pendingParent,
        resumeChildren: [...resumeChildren],
        checkpoint: args.checkpoint.current(),
      })
      await persistSandboxRotationReceipt({ atlasHome: args.atlasHome, receipt })
      return receipt
    },
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
