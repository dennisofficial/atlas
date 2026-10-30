import type { SandboxActivityPost } from '@dltech/atlas-wire'

import { createApiClient, type ApiRemote } from './api-client'
import { EServeEvent, type ServeLog } from './serve-log'

export type ActivityState = SandboxActivityPost

export type ActivityReporter = {
  report: (state: ActivityState) => void
  whenIdle: () => Promise<void>
}

export const httpSendActivity = (args: { remote: ApiRemote; threadId?: string | undefined }) => {
  const client = createApiClient(args.remote)
  return async (state: ActivityState): Promise<void> => {
    await client.sandboxSelf.activity.mutate(
      args.threadId === undefined ? state : { ...state, threadId: args.threadId },
    )
  }
}

export function createActivityReporter(args: {
  send: (state: ActivityState) => Promise<void>
  log: ServeLog
}): ActivityReporter {
  let latest: ActivityState | undefined
  let lastSent: string | undefined
  let running: Promise<void> | undefined

  const drain = async (): Promise<void> => {
    try {
      while (latest !== undefined) {
        const state = latest
        latest = undefined
        const key = JSON.stringify(state)
        if (key === lastSent) continue
        try {
          await args.send(state)
          lastSent = key
        } catch (failure) {
          args.log({
            event: EServeEvent.ActivityReportFailed,
            reason: failure instanceof Error ? failure.message : String(failure),
          })
        }
      }
    } finally {
      running = undefined
    }
  }

  return {
    report: (state) => {
      latest = state
      running ??= Promise.resolve().then(drain)
    },
    whenIdle: () => running ?? Promise.resolve(),
  }
}
