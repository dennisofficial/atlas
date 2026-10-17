import type { ThreadId } from '@dltech/atlas-core'
import { flushSessionInput } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

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
  owed: { parent: boolean; children: readonly ThreadId[] }
  haltIdle: () => void
  whenMutationsSettled: () => Promise<void>
  checkpoint: Pick<RuntimeCheckpointBinding, 'finalizeRotation' | 'current'>
  close: (given: { reason: string }) => Promise<void>
  exit: (code: number) => void
  log: ServeLog
}): ServeDrain {
  let pendingParent = false
  const resumeChildren = new Set<string>(args.owed.children.map(String))
  const owedParent = args.owed.parent
  const collectObligations = async (): Promise<void> => {
    const pending = args.app.intake?.threadsWithPendingInput() ?? args.app.pending?.threadsAwaitingInput() ?? []
    pendingParent ||= pending.includes(args.threadId)
    for (const threadId of pending) if (threadId !== args.threadId) resumeChildren.add(threadId)
  }
  const resumePayload = (): { parent: boolean; children: string[] } => ({
    parent: owedParent || pendingParent || args.driver.busy(),
    children: [...resumeChildren],
  })
  return createServeDrain({
    threadId: args.threadId,
    driver: args.driver,
    suspendIntake: () => {
      args.haltIdle()
      args.app.intake?.suspend()
    },
    resumeIntake: () => {
      args.app.intake?.resume()
    },
    flushInput: async () => {
      await args.whenMutationsSettled()
      await collectObligations()
      if (args.app.intake !== undefined) {
        const written = await flushSessionInput({ intake: args.app.intake, log: args.app.log, ids: args.app.ids })
        pendingParent ||= written.includes(args.threadId)
      }
      if ((args.app.pending?.waitingCount() ?? 0) > 0) {
        throw new Error('queued input has not been persisted — nothing was destroyed')
      }
    },
    seal: async ({ resumeParent }) => {
      await args.checkpoint.finalizeRotation({
        resume: { ...resumePayload(), parent: resumeParent || resumePayload().parent },
      })
      const current = args.checkpoint.current()
      if (current?.phase !== ERuntimePhase.Updating) {
        throw new Error('the drain seal produced no updating checkpoint')
      }
      return current.receipt
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
