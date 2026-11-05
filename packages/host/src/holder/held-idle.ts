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
}): boolean => {
  if (args.turnRunning || args.released || args.runtime === undefined) return false
  return serveIdleDue({
    lastActivityAt: args.lastActivityAt,
    turnRunning: args.turnRunning,
    childrenSettling: false,
    runningShells: 0,
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

const revokeOnDrain = async (args: {
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
  epoch: number
}): Promise<void> => {
  const { runtime } = args
  if (runtime === undefined) return
  if (args.draining) {
    await runtime.stop()
    if (!args.lostOwnership) await revokeOnDrain(args).catch(() => undefined)
    return
  }
  if (!args.released) runtime.remoteCalls.close()
}

export const releaseIdleSession = async (args: {
  deps: HeldSessionDeps
  end(): Promise<void>
}): Promise<void> => {
  const { deps } = args
  try {
    await args.end()
    await deps.plane.revoke({ sessionId: deps.sessionId, wantsHolder: false })
  } catch (error) {
    deps.log?.error({
      source: 'holder.idle',
      message: `idle release of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
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
  end(): Promise<void>
  record: SessionRecord | undefined
  drop(): void
  finish(): void
}): Promise<void> => {
  const { deps } = args
  try {
    await releaseIdleSession({ deps, end: args.end })
    const maybePending = await lateInputMaybePending({
      deps,
      failure: activeFailure(args.record?.eventCache().all() ?? []),
    })
    args.drop()
    if (!maybePending) return
    deps.onDrop?.()
    await deps.plane.wake({ sessionIds: [deps.sessionId] }).catch(() => undefined)
  } finally {
    args.drop()
    args.finish()
  }
}
