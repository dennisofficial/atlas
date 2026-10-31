import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'
import {
  bindChildThreadActivity,
  bindThreadActivity,
  NOOP_ACTIVITY_TRACKER,
  type ActivityTracker,
} from '@dltech/atlas-harness/activity'
import { mirrorsThreadState } from '@dltech/atlas-wire'

import type { ApiRemote } from './api-client'
import {
  createActivityReporter,
  httpSendActivity,
  type ActivityReporter,
} from './serve-activity-reporter'
import type { ServeApp } from './serve-app'
import type { ServeLog } from './serve-log'

export { backgroundRunning } from '@dltech/atlas-harness/activity'

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
  app: Pick<ServeApp, 'log' | 'roster'> & { channel: Pick<DeltaChannel, 'subscribe'> }
  threadId: ThreadId
  remote: ApiRemote
  log: ServeLog
  reporter?: ActivityReporter | undefined
}): ServeActivity {
  if (!mirrorsThreadState(args.env)) return NOOP_SERVE_ACTIVITY
  const reporter =
    args.reporter ??
    createActivityReporter({ send: httpSendActivity({ remote: args.remote }), log: args.log })
  const binding = bindThreadActivity({
    threadId: args.threadId,
    log: args.app.log,
    channel: args.app.channel,
    roster: args.app.roster,
    report: reporter.report,
  })
  return {
    tracker: binding.tracker,
    reportParked: async () => {
      reporter.report({ working: false, awaiting: null })
      await reporter.whenIdle()
    },
    detach: binding.detach,
  }
}

export function bindChildActivity(args: {
  threadId: ThreadId
  channel: Pick<DeltaChannel, 'subscribe'>
  remote: ApiRemote
  log: ServeLog
  reporter?: ActivityReporter | undefined
}): { detach: () => void } {
  const reporter =
    args.reporter ??
    createActivityReporter({
      send: httpSendActivity({ remote: args.remote, threadId: args.threadId }),
      log: args.log,
    })
  return bindChildThreadActivity({
    threadId: args.threadId,
    channel: args.channel,
    report: reporter.report,
  })
}
