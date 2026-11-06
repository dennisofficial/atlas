import {
  activeFailure,
  drainWantsHolder,
  isResumable,
  serveIdleDue,
  workspaceStateOf,
  type PrepareFailure,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { SessionRuntime } from './ports'
import { actionableEntries, isStop, readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRecord } from './record/record-adapter'

export const idleReleaseDue = (args: {
  deps: HeldSessionDeps
  turnRunning: boolean
  lastActivityAt: number
  runtime: SessionRuntime | undefined
  released: boolean
  pendingInput: boolean
  runningShells: number
}): boolean => {
  if (args.turnRunning || args.released || args.runtime === undefined) return false
  return serveIdleDue({
    lastActivityAt: args.lastActivityAt,
    turnRunning: args.turnRunning,
    childrenSettling: false,
    runningShells: args.runningShells,
    runningServices: 0,
    pendingInput: args.pendingInput,
    idleMinutes: args.deps.idleMinutes,
    now: args.deps.timers.now(),
  })
}

const drainNeedsHolder = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  turnRunning: boolean
}): Promise<boolean> => {
  const events = args.record?.eventCache().all() ?? []
  try {
    const entries = await readFullInbox(args.deps)
    const workspace = workspaceStateOf({
      events,
      preparing: false,
      pendingMessageIds: entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
    })
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      resumable: isResumable(args.record?.eventCache().visibleLoopEvents() ?? []),
      messagePending: actionableEntries({ entries, failure: workspace.failure }).length > 0,
      workspace: workspace.state,
      retryPending: workspace.retryPending,
    })
  } catch {
    return true
  }
}

const revokeAndRewake = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  turnRunning: boolean
  epoch: number
}): Promise<void> => {
  const { deps } = args
  const wantsHolder = await drainNeedsHolder(args)
  await deps.plane.revoke({
    sessionId: deps.sessionId,
    wantsHolder,
    epoch: args.epoch,
    resetRetry: true,
  })
  if (wantsHolder) return
  const maybePending = await lateInputMaybePending({
    deps,
    failure: activeFailure(args.record?.eventCache().all() ?? []),
  })
  if (maybePending) await deps.plane.wake({ sessionIds: [deps.sessionId] })
}

export const teardownHeldSession = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime | undefined
  record: SessionRecord | undefined
  turnRunning: boolean
  draining: boolean
  lostOwnership: boolean
  released: boolean
  failedToStart: boolean
  gaveUpStarting: boolean
  epoch: number
}): Promise<void> => {
  const { runtime, deps } = args
  if (args.failedToStart) {
    await deps.plane
      .revoke({
        sessionId: deps.sessionId,
        wantsHolder: !args.gaveUpStarting,
        epoch: args.epoch,
        resetRetry: args.gaveUpStarting,
      })
      .catch(() => undefined)
  }
  if (runtime === undefined) return
  if (args.draining) {
    await runtime.stop()
    if (!args.lostOwnership) await revokeAndRewake(args).catch(() => undefined)
    return
  }
  if (args.released) return
  if (args.lostOwnership) {
    runtime.remoteCalls.close()
    return
  }
  await runtime.stop().catch((error) => logSettleFault({ deps, error, what: 'stopping' }))
  if (args.failedToStart) return
  await revokeAndRewake(args).catch((error) => logSettleFault({ deps, error, what: 'revoking' }))
}

const logSettleFault = (args: { deps: HeldSessionDeps; error: unknown; what: string }): void => {
  args.deps.log?.error({
    source: 'holder.settle',
    message: `${args.what} ${args.deps.sessionId} after its loop ended failed`,
    ...logFieldsOf({ error: args.error }),
  })
}

export type IdleReleaseOutcome = 'released' | 'superseded' | 'failed'

export const releaseIdleSession = async (args: {
  deps: HeldSessionDeps
  epoch: number
  end(): Promise<void>
}): Promise<IdleReleaseOutcome> => {
  const { deps } = args
  try {
    const current = await deps.plane.currentLease({ sessionId: deps.sessionId })
    if (current.lease.epoch !== args.epoch) return 'superseded'
    await args.end()
    const revoked = await deps.plane.revoke({
      sessionId: deps.sessionId,
      wantsHolder: false,
      epoch: args.epoch,
      resetRetry: true,
    })
    return revoked.ok ? 'released' : 'superseded'
  } catch (error) {
    deps.log?.error({
      source: 'holder.idle',
      message: `idle release of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
    return 'failed'
  }
}

const lateInputMaybePending = async (args: {
  deps: HeldSessionDeps
  failure: PrepareFailure | undefined
}): Promise<boolean> => {
  try {
    const late = await readFullInbox(args.deps)
    return actionableEntries({ entries: late, failure: args.failure }).length > 0
  } catch {
    return true
  }
}

export const releaseIdleAndRewake = async (args: {
  deps: HeldSessionDeps
  epoch: number
  end(): Promise<void>
  record: SessionRecord | undefined
  drop(): void
}): Promise<IdleReleaseOutcome> => {
  const { deps } = args
  const outcome = await releaseIdleSession({ deps, epoch: args.epoch, end: args.end })
  if (outcome === 'failed') return outcome
  try {
    if (outcome === 'superseded') return outcome
    const maybePending = await lateInputMaybePending({
      deps,
      failure: activeFailure(args.record?.eventCache().all() ?? []),
    })
    args.drop()
    if (!maybePending) return outcome
    deps.onDrop?.()
    await deps.plane.wake({ sessionIds: [deps.sessionId] }).catch(() => undefined)
    return outcome
  } finally {
    args.drop()
  }
}
