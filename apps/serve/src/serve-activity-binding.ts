import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'
import { mirrorsThreadState } from '@dltech/atlas-wire'

import type { ApiRemote } from './api-client'
import { createApprovalWatcher } from './serve-activity-approval'
import {
  createActivityReporter,
  httpSendActivity,
  type ActivityReporter,
} from './serve-activity-reporter'
import {
  createActivityTracker,
  NOOP_ACTIVITY_TRACKER,
  type ActivityTracker,
} from './serve-activity-state'
import type { ServeApp } from './serve-app'
import type { ServeLog } from './serve-log'

export type ServeActivity = {
  tracker: ActivityTracker
  reportParked: () => Promise<void>
  detach: () => void
}

export const NOOP_SERVE_ACTIVITY: ServeActivity = {
  tracker: NOOP_ACTIVITY_TRACKER,
  reportParked: async () => undefined,
  detach: () => undefined,
}

export function bindServeActivity(args: {
  env: Record<string, string | undefined>
  app: Pick<ServeApp, 'log'> & { channel: Pick<DeltaChannel, 'subscribe'> }
  threadId: ThreadId
  remote: ApiRemote
  log: ServeLog
  reporter?: ActivityReporter | undefined
}): ServeActivity {
  if (!mirrorsThreadState(args.env)) return NOOP_SERVE_ACTIVITY
  const reporter =
    args.reporter ?? createActivityReporter({ send: httpSendActivity(args.remote), log: args.log })
  const tracker = createActivityTracker({ report: reporter.report })
  const approvals = createApprovalWatcher({
    threadId: args.threadId,
    log: args.app.log,
    onChange: tracker.setApproval,
  })
  const unsubscribe = args.app.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      if (signal.type === 'operator-input') tracker.setInput(signal.request !== null)
      if (signal.type === 'events-appended' || signal.type === 'step-ended') approvals.refresh()
    },
  })
  approvals.refresh()
  return {
    tracker,
    reportParked: async () => {
      reporter.report({ working: false, awaiting: null })
      await reporter.whenIdle()
    },
    detach: unsubscribe,
  }
}
