import type { PluginViewFold } from '@dltech/atlas-core'

import { restoredWindowOf } from './session-log-restore'
import type { SessionLog } from './session-log'
import type { SessionWindow } from './session-window'
import type { StreamScheduler } from './stream-ports'

export const HYDRATE_TIMEOUT_MS = 2_000

export const hydrateFollower = (args: {
  log: SessionLog
  sessionId: string
  renderLimit: number
  views?: readonly PluginViewFold[] | undefined
  scheduler: StreamScheduler
  restore: (window: SessionWindow) => void
}): Promise<void> => {
  let settled = false
  return new Promise<void>((resolve) => {
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      args.scheduler.clearTimeout(timer)
      resolve()
      return true
    }
    const timer = args.scheduler.setTimeout(settle, HYDRATE_TIMEOUT_MS)
    restoredWindowOf({
      log: args.log,
      sessionId: args.sessionId,
      renderLimit: args.renderLimit,
      views: args.views,
    })
      .then((window) => {
        if (!settle() || window === undefined) return
        args.restore(window)
      })
      .catch(() => void settle())
  })
}
