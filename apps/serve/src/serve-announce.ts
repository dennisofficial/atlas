import { isResumable, type EnvironmentCapabilities, type ThreadId } from '@dltech/atlas-core'

import { syncCapabilitiesNotice } from './capabilities-notice'
import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

/**
 * A turn cut short by the container stopping leaves its events durable and nothing else, so the
 * one thing boot owes a client is to say the thread is mid-turn rather than to look alive.
 */
export async function announceBoot(args: {
  app: ServeApp
  threadId: ThreadId
  capabilities: EnvironmentCapabilities | undefined
  log: ServeLog
}): Promise<{ resumable: boolean }> {
  const { app, threadId, capabilities, log } = args
  const events = await app.log.read({ threadId }).catch(() => [])
  if (capabilities !== undefined) {
    await syncCapabilitiesNotice({
      log: app.log,
      threadId,
      runId: app.ids.nextRunId(),
      events,
      capabilities,
    }).catch(() => false)
  }
  const resumable = isResumable(events)
  if (resumable) log({ event: EServeEvent.Resumable, head: events.at(-1)?.seq ?? 0 })
  return { resumable }
}
