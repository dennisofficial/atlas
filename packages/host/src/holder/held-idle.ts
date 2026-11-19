import type { SessionRuntime } from './ports'

export const idleReleaseDue = (args: {
  turnRunning: boolean
  runtime: SessionRuntime | undefined
  pendingInput: boolean
  runningShells: number
  runningChildren: number
}): boolean => {
  if (args.turnRunning || args.runtime === undefined) return false
  return !args.pendingInput && args.runningShells === 0 && args.runningChildren === 0
}
