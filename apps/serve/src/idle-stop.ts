import { serveIdleDue } from '@dltech/atlas-core'

export const SERVE_IDLE_MINUTES = 5

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
  onDue: () => void
  idleMinutes?: number | undefined
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

      const busy =
        turnRunning ||
        childrenSettling ||
        runningChildren > 0 ||
        runningShells > 0 ||
        runningServices > 0 ||
        pendingInput
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
        idleMinutes: args.idleMinutes ?? SERVE_IDLE_MINUTES,
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
