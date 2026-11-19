import type { SessionRuntime } from './ports'

export const idleReleaseDue = (args: {
  turnRunning: boolean
  runtime: SessionRuntime | undefined
  pendingInput: boolean
  runningShells: number
  runningChildren: number
  terminalStreams: number
}): boolean => {
  if (args.turnRunning || args.runtime === undefined) return false
  if (args.terminalStreams > 0) return false
  return !args.pendingInput && args.runningShells === 0 && args.runningChildren === 0
}
