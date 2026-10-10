import { isResumable, toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EServeFrame,
  ETurnStatus,
  deleteSandboxRotationState,
  persistSandboxRotationState,
  persistSandboxRotationIntent,
  readSandboxRotationState,
} from '@dltech/atlas-harness'

import type { LifecycleFrame } from './frame-buffer'
import type { ServeApp } from './serve-app'
import type { ServeDrain } from './serve-drain'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'
import type { createServeWorkspaceSession } from './serve-workspace-session'
import { trackRotationChildren } from './serve-rotation-children'

type RecoverySession = ReturnType<typeof createServeWorkspaceSession>

export async function createServeRotationRecovery(args: {
  atlasHome: string
  threadId: ThreadId
  sandboxSessionId: string | undefined
  log: ServeLog
}) {
  const state = await readSandboxRotationState({ atlasHome: args.atlasHome })
  if (state !== null && state.threadId !== args.threadId) {
    throw new Error(`sandbox rotation belongs to ${state.threadId}, not ${args.threadId}`)
  }
  if (state !== null && !args.sandboxSessionId?.trim()) {
    throw new Error('sandbox rotation recovery requires ATLAS_SANDBOX_SESSION_ID')
  }
  const sourceRestart = state !== null && state.sandboxSessionId === args.sandboxSessionId
  const sourceConsumption = sourceRestart
    ? deleteSandboxRotationState({ atlasHome: args.atlasHome }).catch((failure: unknown) => {
      args.log({ event: EServeEvent.CheckpointPersistFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    })
    : undefined
  let guarded: { app: ServeApp; admission: { closed: boolean } } | undefined
  let continuationStarted = false
  let consumption: Promise<void> | undefined
  let preparingNextRotation = false
  let recovering: Promise<void> | undefined
  let activating: Promise<{ activated: boolean }> | undefined
  let consumedParent = false
  let children: Awaited<ReturnType<typeof trackRotationChildren>> | undefined
  const resumeChildren = state?.resumeChildren?.map(toThreadId)

  const consumeObligations = (given: { parent?: boolean; children?: readonly ThreadId[] }): Promise<void> => {
    if (state === null || sourceRestart || preparingNextRotation) return Promise.resolve()
    const writing = (consumption ?? Promise.resolve()).then(async () => {
      const current = await readSandboxRotationState({ atlasHome: args.atlasHome })
      if (current === null || current.threadId !== state.threadId || current.sandboxSessionId !== state.sandboxSessionId) return
      await persistSandboxRotationState({ atlasHome: args.atlasHome, state: {
        ...current,
        ...(given.parent === true ? { resumeParent: false } : {}),
        ...(given.children === undefined ? {} : { resumeChildren: (current.resumeChildren ?? []).filter((child) => !given.children?.includes(toThreadId(child))) }),
      } })
      if (given.parent === true) consumedParent = true
    })
    consumption = writing.catch((failure: unknown) => {
      args.log({ event: EServeEvent.CheckpointPersistFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    })
    return writing
  }

  const guard = async (given: { app: ServeApp; admission: { closed: boolean } }): Promise<void> => {
    guarded = given
    if (state === null) return
    if (sourceRestart) {
      if (sourceConsumption !== undefined) await sourceConsumption
      return
    }
    given.admission.closed = true
    given.app.intake?.suspend()
    await given.app.family?.freeze?.({ threadId: args.threadId })
    if (children === undefined && (resumeChildren?.length ?? 0) > 0) {
      children = await trackRotationChildren({
        app: given.app, root: args.threadId, children: resumeChildren ?? [], log: args.log,
        consume: (completed) => consumeObligations({ children: completed }),
      })
    }
  }

  const release = async (): Promise<void> => {
    if (guarded === undefined || preparingNextRotation) return
    await guarded.app.family?.resumeChildren?.({ threadId: args.threadId })
    if (preparingNextRotation) return
    guarded.admission.closed = false
    guarded.app.intake?.resume()
  }

  const continueParent = async (given: { session: RecoverySession; driver: ServeTurnDriver }): Promise<void> => {
    if (guarded === undefined || state === null || preparingNextRotation || !state.resumeParent || continuationStarted || given.session.dormant()) return
    const events = await guarded.app.log.readOwn({ threadId: args.threadId })
    if (preparingNextRotation || !isResumable(events)) return
    guarded.admission.closed = false
    given.driver.run({ resume: true, onlyIfIdle: true })
    continuationStarted = true
  }

  const discardIfConsumed = async (): Promise<void> => {
    if (state === null || sourceRestart || preparingNextRotation) return
    const current = await readSandboxRotationState({ atlasHome: args.atlasHome })
    if (current?.sandboxSessionId !== state.sandboxSessionId) return
    if (current.resumeParent || (current.resumeChildren ?? []).length > 0) return
    await deleteSandboxRotationState({ atlasHome: args.atlasHome })
  }

  return {
    deferred: state !== null && !sourceRestart,
    resumeChildren: sourceRestart ? undefined : resumeChildren,
    checkpointAllowed: true,
    guard,
    recover(given: { session: RecoverySession; driver: ServeTurnDriver }): Promise<void> {
      if (state === null || sourceRestart || preparingNextRotation) return Promise.resolve()
      recovering ??= (async () => {
        if (!given.session.dormant()) await given.session.startChildren()
        children?.changed()
        await continueParent(given)
        await release()
      })().finally(() => { recovering = undefined })
      return recovering
    },
    activate(given: { session: RecoverySession; driver: ServeTurnDriver }): Promise<{ activated: boolean }> {
      if (sourceRestart || preparingNextRotation) return Promise.reject(new Error('this sandbox is still preparing rotation and accepts no new work'))
      activating ??= (async () => {
        const heldForActivation = state !== null && guarded !== undefined && given.session.dormant()
        if (heldForActivation && guarded !== undefined) await guard(guarded)
        if (preparingNextRotation) return { activated: false }
        const result = await given.session.activate()
        children?.changed()
        await continueParent(given)
        if (heldForActivation) await release()
        await discardIfConsumed()
        return result
      })().finally(() => { activating = undefined })
      return activating
    },
    async drain(given: { drain: ServeDrain; reason: string }): ReturnType<ServeDrain> {
      preparingNextRotation = true
      if (guarded !== undefined) {
        guarded.admission.closed = true
        guarded.app.intake?.suspend()
      }
      const releaseFailedDrain = (): void => {
        preparingNextRotation = false
        if (guarded === undefined) return
        guarded.admission.closed = false
        guarded.app.intake?.resume()
      }
      try {
        await Promise.all([recovering, activating])
        if (consumption !== undefined) await consumption
        if (state !== null && args.sandboxSessionId !== undefined && state.sandboxSessionId !== args.sandboxSessionId) {
          const current = await readSandboxRotationState({ atlasHome: args.atlasHome })
          if (current?.sandboxSessionId === state.sandboxSessionId) await persistSandboxRotationIntent({
            atlasHome: args.atlasHome, threadId: args.threadId, sandboxSessionId: args.sandboxSessionId,
            resumeParent: current.resumeParent, resumeChildren: current.resumeChildren ?? [],
          })
        }
      } catch (failure) {
        releaseFailedDrain()
        throw failure
      }
      return given.drain({ reason: given.reason }).catch((failure: unknown) => {
        releaseFailedDrain()
        throw failure
      })
    },
    consume(frame: LifecycleFrame): void {
      if (state === null || sourceRestart || preparingNextRotation || !state.resumeParent || consumedParent) return
      if (frame.kind !== EServeFrame.TurnEnded) return
      const status = frame.outcome.status
      if (status !== ETurnStatus.Completed && status !== ETurnStatus.Idle && status !== ETurnStatus.Paused && status !== ETurnStatus.Failed) return
      void consumeObligations({ parent: true }).then(discardIfConsumed).catch(() => undefined)
    },
    detach: (): void => children?.detach(),
    settled: async (): Promise<void> => { await children?.settled(); await consumption },
  }
}
