import { deliveredDraftOf, owedNotices, type Event, type ThreadId } from '@dltech/atlas-core'

import type { ServiceNoticeQueue } from './service-notices'

export function requeueOwedServiceNotices({
  events,
  threadId,
  notices,
}: {
  events: readonly Event[]
  threadId: ThreadId
  notices: ServiceNoticeQueue
}): void {
  for (const arrival of owedNotices(events)) {
    if (arrival.threadId !== threadId || arrival.type !== 'service-ended') continue

    const draft = deliveredDraftOf(arrival)
    if (draft === undefined) continue
    notices.queue({
      threadId,
      draft,
      snapshot: {
        serviceId: arrival.serviceId,
        command: arrival.command,
        description: arrival.description ?? '',
        status: arrival.status,
        killedBy: arrival.killedBy,
        exitCode: arrival.exitCode,
        logPath: arrival.logPath ?? '',
        startedAt: arrival.at,
        endedAt: arrival.at,
      },
    })
  }
}
