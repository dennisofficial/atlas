import { serveIdleDue } from '@dltech/atlas-core'

export const SERVE_IDLE_MINUTES = 5
export const SERVE_SERVICE_IDLE_MINUTES = 30

const IDLE_TICK_MS = 30_000

export type ServeIdleStop = {
  note: () => void
  halt: () => void
  check: () => boolean
  reset: () => void
}

export function startServeIdleStop(args: {
  turnRunning: () => boolean
  childrenSettling: () => boolean
  runningShells: () => number
  runningServices: () => number
  runningChildren?: (() => number) | undefined
  pendingInput?: (() => boolean) | undefined
  clientsAttached?: (() => number) | undefined
  onDue: () => void
  idleMinutes?: number | undefined
  serviceIdleMinutes?: number | undefined
  tickMs?: number | undefined
  now?: (() => number) | undefined
  log?: ((line: string) => void) | undefined
}): ServeIdleStop {
  const now = args.now ?? Date.now
  let quietSince: number | undefined
  let fired = false

  const check = (): boolean => {
    if (fired) return false

    let due = false
    try {
      const turnRunning = args.turnRunning()
      const childrenSettling = args.childrenSettling()
      const runningChildren = args.runningChildren?.() ?? 0
      const runningShells = args.runningShells()
      const runningServices = args.runningServices()
      const pendingInput = args.pendingInput?.() ?? false
      const clientsAttached = args.clientsAttached?.() ?? 0

      const busy =
        turnRunning ||
        childrenSettling ||
        runningChildren > 0 ||
        runningShells > 0 ||
        pendingInput ||
        (runningServices > 0 && clientsAttached > 0)
      if (busy) {
        quietSince = undefined
        return false
      }
      if (quietSince === undefined) {
        quietSince = now()
        return false
      }

      due = serveIdleDue({
        lastActivityAt: quietSince,
        turnRunning,
        childrenSettling,
        runningChildren,
        runningShells,
        runningServices,
        pendingInput,
        clientsAttached,
        idleMinutes: args.idleMinutes ?? SERVE_IDLE_MINUTES,
        serviceIdleMinutes: args.serviceIdleMinutes ?? SERVE_SERVICE_IDLE_MINUTES,
        now: now(),
      })
    } catch (failure) {
      quietSince = undefined
      args.log?.(
        `idle check failed, the quiet window restarts: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
      return false
    }
    if (!due) return false

    fired = true
    args.onDue()
    return true
  }

  const timer = setInterval(check, args.tickMs ?? IDLE_TICK_MS)
  timer.unref()

  return {
    note: () => {
      quietSince = now()
    },
    halt: () => clearInterval(timer),
    check,
    reset: () => {
      fired = false
      quietSince = undefined
    },
  }
}
