import { startServeIdleStop, type ServeIdleStop } from './idle-stop'
import type { ServeArgs } from './serve-args'
import { EServeEvent, type ServeLog } from './serve-log'

type ServeWork = {
  settlingWork: boolean
  childrenRunning: number
  shellsRunning: number
  servicesRunning: number
  pendingInput: boolean
}

export function bindServeIdleStop(args: {
  serveArgs: ServeArgs
  turnRunning: () => boolean
  work: () => ServeWork
  clientsAttached: () => number
  log: ServeLog
  onDue: () => void
}): ServeIdleStop {
  const { serveArgs, work } = args
  return startServeIdleStop({
    turnRunning: args.turnRunning,
    childrenSettling: () => work().settlingWork,
    runningChildren: () => work().childrenRunning,
    runningShells: () => work().shellsRunning,
    runningServices: () => work().servicesRunning,
    pendingInput: () => work().pendingInput,
    clientsAttached: args.clientsAttached,
    idleMinutes: serveArgs.idleMinutes,
    serviceIdleMinutes: serveArgs.serviceIdleMinutes,
    tickMs: serveArgs.idleTickMs,
    log: (line) => args.log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: args.onDue,
  })
}
