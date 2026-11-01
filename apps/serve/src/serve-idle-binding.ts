import type { ThreadId } from '@dltech/atlas-core'

import { startServeIdleStop, type ServeIdleStop } from './idle-stop'
import type { RuntimeWork } from './runtime-work'
import type { ServeArgs } from './serve-args'
import { bindServeDeadline } from './serve-deadline-binding'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeRollover } from './serve-rollover'

export const noopIdle = (noop: () => void) => ({ note: noop, halt: noop, reset: noop })

export function bindServeIdleStop(args: {
  serveArgs: ServeArgs
  deadline: {
    env: Record<string, string | undefined>
    threadId: ThreadId
    remote: {
      controlPlaneUrl: string
      token: string
      clientVersion?: string | undefined
      fetchFn?: typeof fetch | undefined
    }
    rollover?: ServeRollover | undefined
  }
  turnRunning: () => boolean
  work: () => RuntimeWork
  clientsAttached: () => number
  log: ServeLog
  onDue: () => void
}): ServeIdleStop {
  const { serveArgs, work } = args
  const idle = startServeIdleStop({
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
    now: serveArgs.now,
    log: (line) => args.log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: args.onDue,
  })
  const deadline = bindServeDeadline({
    serveArgs,
    env: args.deadline.env,
    threadId: args.deadline.threadId,
    ...args.deadline.remote,
    work,
    quietSince: idle.quietSince,
    rollover: args.deadline.rollover,
    log: args.log,
  })
  return {
    ...idle,
    halt: () => {
      idle.halt()
      deadline?.halt()
    },
    reset: () => {
      idle.reset()
      deadline?.reset()
    },
  }
}
