import type { PluginViewFold } from '@dltech/atlas-core'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { restoredWindowResultOf } from './session-log-restore'
import type { SessionLog } from './session-log'
import type { SessionWindow } from './session-window'
import type { StreamScheduler } from './stream-ports'

export const HYDRATE_TIMEOUT_MS = 6_000

export type FollowerHydration = { outcome: EStreamCacheOutcome; ms: number }

export const hydrateFollower = (args: {
  log: SessionLog
  sessionId: string
  renderLimit: number
  views?: readonly PluginViewFold[] | undefined
  scheduler: StreamScheduler
  restore: (window: SessionWindow) => void
}): Promise<FollowerHydration> => {
  let settled = false
  const startedAt = args.scheduler.now()
  return new Promise<FollowerHydration>((resolve) => {
    const settle = (outcome: EStreamCacheOutcome): boolean => {
      if (settled) return false
      settled = true
      args.scheduler.clearTimeout(timer)
      resolve({ outcome, ms: Math.max(0, Math.round(args.scheduler.now() - startedAt)) })
      return true
    }
    const timer = args.scheduler.setTimeout(
      () => void settle(EStreamCacheOutcome.Timeout),
      HYDRATE_TIMEOUT_MS,
    )
    restoredWindowResultOf({
      log: args.log,
      sessionId: args.sessionId,
      renderLimit: args.renderLimit,
      views: args.views,
    })
      .then((result) => {
        if (!settle(result.outcome) || result.window === undefined) return
        args.restore(result.window)
      })
      .catch(() => void settle(EStreamCacheOutcome.Failed))
  })
}
