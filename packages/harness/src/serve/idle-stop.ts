import { serveIdleDue } from '@dltech/atlas-core'

export const SERVE_IDLE_MINUTES = 5
export const SERVE_IDLE_MINUTES_WITH_SERVICES = 30

const IDLE_TICK_MS = 30_000

export type ServeIdleStop = {
  /** Work is the only attention that counts: a socket merely open must let the sandbox park. */
  note: () => void
  halt: () => void
}

/**
 * The parked-sandbox half of the park model: serve exits when the conversation goes quiet, Vercel
 * sees a sandbox with nothing running and parks it, and the next message reattaches through the
 * ordinary wake path. The creation-time timeout stays as the outer backstop; nothing extends it.
 */
export function startServeIdleStop(args: {
  turnRunning: () => boolean
  childrenSettling: () => boolean
  runningShells: () => number
  runningServices: () => number
  onDue: () => void
  idleMinutes?: number | undefined
  idleMinutesWithServices?: number | undefined
  tickMs?: number | undefined
  now?: (() => number) | undefined
}): ServeIdleStop {
  const now = args.now ?? Date.now
  let lastActivityAt = now()
  let fired = false

  const tick = (): void => {
    if (fired) return

    let due = false
    try {
      due = serveIdleDue({
        lastActivityAt,
        turnRunning: args.turnRunning(),
        childrenSettling: args.childrenSettling(),
        runningShells: args.runningShells(),
        runningServices: args.runningServices(),
        idleMinutes: args.idleMinutes ?? SERVE_IDLE_MINUTES,
        idleMinutesWithServices: args.idleMinutesWithServices ?? SERVE_IDLE_MINUTES_WITH_SERVICES,
        now: now(),
      })
    } catch {
      return
    }
    if (!due) return

    fired = true
    args.onDue()
  }

  const timer = setInterval(tick, args.tickMs ?? IDLE_TICK_MS)
  timer.unref()

  return {
    note: () => {
      lastActivityAt = now()
    },
    halt: () => clearInterval(timer),
  }
}
