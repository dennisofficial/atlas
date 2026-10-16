import type { ThreadId } from '@dltech/atlas-core'
import { flushSessionInput, persistSandboxRotationIntent, persistSandboxRotationReceipt, readSandboxRotationState } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import type { RuntimeCheckpointBinding } from './runtime-checkpoint-binding'
import type { ServeApp } from './serve-app'
import { createServeDrain, type ServeDrain } from './serve-drain'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export function bindServeDrain(args: {
  app: ServeApp
  driver: ServeTurnDriver
  threadId: ThreadId
  atlasHome: string
  sandboxSessionId: string
  haltIdle: () => void
  whenMutationsSettled: () => Promise<void>
  checkpoint: Pick<RuntimeCheckpointBinding, 'finalizeRotation' | 'rotationReopened' | 'current'>
  close: (given: { reason: string }) => Promise<void>
  exit: (code: number) => void
  log: ServeLog
}): ServeDrain {
  let pendingParent = false
  let previousIntent = false
  let preparingSeal = false
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
  const resumePayload = (): { parent: boolean; children: string[] } => ({
    parent: previousIntent || pendingParent || args.driver.busy(),
    children: [...resumeChildren],
  })
  return createServeDrain({
    threadId: args.threadId,
    driver: args.driver,
    closeAdmission: () => {
      args.haltIdle()
      args.app.intake?.suspend()
    },
    reopenAdmission: () => {
      void args.checkpoint.rotationReopened().catch((failure: unknown) => {
        args.log({
          event: EServeEvent.CheckpointPersistFailed,
          reason: failure instanceof Error ? failure.message : String(failure),
        })
      })
      args.app.intake?.resume()
    },
    drainingClosed: () => preparingSeal,
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
      preparingSeal = true
      await args.checkpoint.finalizeRotation({
        resume: { ...resumePayload(), parent: resumeParent || resumePayload().parent },
      })
      const current = args.checkpoint.current()
      if (current?.phase !== ERuntimePhase.Updating) {
        throw new Error('the drain seal produced no updating checkpoint')
      }
      const receipt = current.receipt
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
