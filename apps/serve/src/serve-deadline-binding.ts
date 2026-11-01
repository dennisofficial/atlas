import type { ThreadId } from '@dltech/atlas-core'

import { deadlineControlFor } from './deadline-control'
import { startDeadlineRenewal, type DeadlineRenewalLoop } from './deadline-renewal-loop'
import { SERVE_IDLE_MINUTES, SERVE_SERVICE_IDLE_MINUTES } from './idle-stop'
import { runtimeHasWork, type RuntimeWork } from './runtime-work'
import type { ServeArgs } from './serve-args'
import type { ServeLog } from './serve-log'

export function bindServeDeadline(args: {
  serveArgs: ServeArgs
  env: Record<string, string | undefined>
  threadId: ThreadId
  token: string
  controlPlaneUrl: string
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
  work: () => RuntimeWork
  quietSince: () => number | undefined
  log: ServeLog
}): DeadlineRenewalLoop | undefined {
  const { serveArgs } = args
  const control =
    serveArgs.deadlineControl ??
    deadlineControlFor({
      threadId: args.threadId,
      controlPlaneUrl: args.controlPlaneUrl,
      env: args.env,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
    })
  if (control === undefined) return undefined
  const graceMinutes = Math.max(
    serveArgs.idleMinutes ?? SERVE_IDLE_MINUTES,
    serveArgs.serviceIdleMinutes ?? SERVE_SERVICE_IDLE_MINUTES,
  )
  return startDeadlineRenewal({
    control,
    working: () => runtimeHasWork(args.work()),
    quietSince: args.quietSince,
    graceMs: graceMinutes * 60_000,
    log: args.log,
    now: serveArgs.now,
    tickMs: serveArgs.deadlineTickMs,
    workSummary: args.work,
  })
}
