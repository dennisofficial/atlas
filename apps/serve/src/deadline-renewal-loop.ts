import { EDeadlineDecision, deadlineRenewal, type DeadlinePolicy } from '@dltech/atlas-core'
import { SANDBOX_SESSION_HARD_LIMIT_MS, type SandboxDeadlineObservation } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'

export const DEADLINE_TICK_MS = 30_000
export const DEADLINE_MARGIN_MS = 5 * 60_000
export const DEADLINE_LEAD_MS = 20 * 60_000

export type DeadlineControl = {
  renew: (args: { until: number }) => Promise<SandboxDeadlineObservation>
}

export type DeadlineState = {
  expiresAt: number | undefined
  hardLimitAt: number | undefined
  renewing: boolean
  failures: number
  halted: boolean
}

export type DeadlineRenewalLoop = {
  tick: () => Promise<void>
  halt: () => void
  reset: () => void
  state: () => DeadlineState
}

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function startDeadlineRenewal(args: {
  control: DeadlineControl
  working: () => boolean
  quietSince: () => number | undefined
  graceMs: number
  log: ServeLog
  now?: (() => number) | undefined
  tickMs?: number | undefined
  hardLimitMs?: number | undefined
  workSummary?: (() => unknown) | undefined
}): DeadlineRenewalLoop {
  const now = args.now ?? Date.now
  const policy: DeadlinePolicy = {
    graceMs: args.graceMs,
    marginMs: DEADLINE_MARGIN_MS,
    leadMs: DEADLINE_LEAD_MS,
  }
  let expiresAt: number | undefined
  let hardLimitAt: number | undefined
  let inFlight: Promise<void> | undefined
  let failures = 0
  let halted = false
  let cappedLogged = false

  const observe = (observation: SandboxDeadlineObservation): void => {
    expiresAt = observation.expiresAt ?? undefined
    if (observation.startedAt !== null)
      hardLimitAt = observation.startedAt + (args.hardLimitMs ?? SANDBOX_SESSION_HARD_LIMIT_MS)
  }

  const renew = async (until: number, working: boolean): Promise<void> => {
    const at = now()
    try {
      const observation = await args.control.renew({ until })
      if (halted) return
      observe(observation)
      failures = 0
      if (observation.extendedByMs > 0)
        args.log({
          event: EServeEvent.DeadlineRenewed,
          sessionId: observation.sessionId,
          extendedByMs: observation.extendedByMs,
          expiresAt,
          hardLimitAt,
          working,
          work: args.workSummary?.(),
        })
    } catch (failure) {
      if (halted) return
      failures += 1
      args.log({
        event: EServeEvent.DeadlineRenewFailed,
        attempt: failures,
        until,
        expiresAt,
        remainingMs: expiresAt === undefined ? undefined : expiresAt - at,
        working,
        reason: reasonOf(failure),
      })
    }
  }

  const tick = (): Promise<void> => {
    if (halted) return Promise.resolve()
    if (inFlight !== undefined) return inFlight
    let working: boolean
    let quietSince: number | undefined
    try {
      working = args.working()
      quietSince = args.quietSince()
    } catch (failure) {
      args.log({
        event: EServeEvent.DeadlineRenewFailed,
        reason: reasonOf(failure),
      })
      return Promise.resolve()
    }
    const decision = deadlineRenewal({
      now: now(),
      expiresAt,
      working,
      quietSince,
      hardLimitAt,
      policy,
    })
    if (decision.capped && !cappedLogged) {
      cappedLogged = true
      args.log({
        event: EServeEvent.DeadlineAtRisk,
        reason: 'the provider session hard limit falls before the idle grace would end',
        expiresAt,
        hardLimitAt,
        working,
        work: args.workSummary?.(),
      })
    }
    if (decision.kind === EDeadlineDecision.Hold) return Promise.resolve()
    inFlight = renew(decision.until, working).finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  const start = (): ReturnType<typeof setInterval> => {
    const handle = setInterval(() => void tick(), args.tickMs ?? DEADLINE_TICK_MS)
    handle.unref()
    return handle
  }
  let timer: ReturnType<typeof setInterval> | undefined = start()
  void tick()

  return {
    tick,
    halt: () => {
      halted = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    reset: () => {
      halted = false
      timer ??= start()
    },
    state: () => ({
      expiresAt,
      hardLimitAt,
      renewing: inFlight !== undefined,
      failures,
      halted,
    }),
  }
}
