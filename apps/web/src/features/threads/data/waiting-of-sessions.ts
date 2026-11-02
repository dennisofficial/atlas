import { waitingForModelSchema, type WaitingForModel } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import type { ProjectThreads } from '@/features/shell/thread-partition'
import type { SessionNode } from './threads-api'

const threadsOf = (node: SessionNode): WireThread[] => [
  node.mainThread,
  ...node.teammates.flatMap(threadsOf),
]

export function waitingOfSessions(entries: readonly ProjectThreads[]): WaitingForModel[] {
  return entries
    .flatMap((entry) => entry.sessions.flatMap(threadsOf))
    .flatMap((thread) => {
      const parsed = waitingForModelSchema.safeParse(thread.status?.waitingForModel)
      return parsed.success ? [parsed.data] : []
    })
}
