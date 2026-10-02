import { isResumable, type ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

/**
 * A turn cut short by the container stopping leaves its events durable and nothing else, so the
 * one thing boot owes a client is to say the thread is mid-turn rather than to look alive.
 */
export async function announceBoot(args: {
  app: ServeApp
  threadId: ThreadId
  log: ServeLog
}): Promise<{ resumable: boolean }> {
  const { app, threadId, log } = args
  const events = await app.log.read({ threadId }).catch(() => [])
  const resumable = isResumable(events)
  if (resumable) log({ event: EServeEvent.Resumable, head: events.at(-1)?.seq ?? 0 })
  return { resumable }
}
