import { serveIdleDue, type PrepareFailure } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { SessionRuntime } from './ports'
import { actionableEntries, readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'

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

export const teardownHeldSession = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime | undefined
  draining: boolean
  lostOwnership: boolean
  released: boolean
  epoch: number
}): Promise<void> => {
  const { deps, runtime } = args
  if (runtime === undefined) return
  if (args.draining) {
    await runtime.stop()
    if (!args.lostOwnership) {
      await deps.plane
        .revoke({ sessionId: deps.sessionId, wantsHolder: true, epoch: args.epoch })
        .catch(() => undefined)
    }
    return
  }
  if (!args.released) runtime.remoteCalls.close()
}

export const releaseIdleSession = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
}): Promise<void> => {
  const { deps } = args
  try {
    await args.runtime.release()
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
  runtime: SessionRuntime
  failure: PrepareFailure | undefined
  drop(): void
  finish(): void
}): Promise<void> => {
  const { deps } = args
  try {
    await releaseIdleSession({ deps, runtime: args.runtime })
    const maybePending = await lateInputMaybePending({ deps, failure: args.failure })
    args.drop()
    if (!maybePending) return
    deps.onDrop?.()
    await deps.plane.wake({ sessionIds: [deps.sessionId] }).catch(() => undefined)
  } finally {
    args.drop()
    args.finish()
  }
}
