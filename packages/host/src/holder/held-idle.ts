import { serveIdleDue } from '@dltech/atlas-core'

import type { SessionRuntime } from './ports'
import type { HeldSessionDeps } from './held-session-deps'

export const idleReleaseDue = (args: {
  deps: HeldSessionDeps
  turnRunning: boolean
  lastActivityAt: number
  runtime: SessionRuntime | undefined
  pendingInput: boolean
  runningShells: number
  runningChildren: number
}): boolean => {
  if (args.turnRunning || args.runtime === undefined) return false
  return serveIdleDue({
    lastActivityAt: args.lastActivityAt,
    turnRunning: args.turnRunning,
    childrenSettling: false,
    runningChildren: args.runningChildren,
    runningShells: args.runningShells,
    runningServices: 0,
    pendingInput: args.pendingInput,
    idleMinutes: args.deps.idleMinutes,
    now: args.deps.timers.now(),
  })
}
