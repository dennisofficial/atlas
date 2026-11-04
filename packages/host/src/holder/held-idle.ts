import { serveIdleDue } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { SessionRuntime } from './ports'
import type { HeldSessionDeps } from './held-session-deps'

export const idleWaitMs = (args: { deps: HeldSessionDeps; lastActivityAt: number }): number => {
  const deadline = args.lastActivityAt + args.deps.idleMinutes * 60_000
  return Math.max(1, deadline - args.deps.timers.now())
}

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
