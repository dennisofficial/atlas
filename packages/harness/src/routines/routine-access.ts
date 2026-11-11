import type { ApiClient } from '@dltech/atlas-api-router'
import type { ThreadId } from '@dltech/atlas-core'

import { createHarnessApiClient } from '../cloud/api-trpc-client'
import type { CloudSession, CloudSessionStore } from '../cloud/cloud-session'
import type { ThreadStorePort } from '../store/thread-store'

export type RoutineAccess = {
  api: ApiClient
  projectId: string | null
}

export type RoutineAccessSource = (args: { threadId: ThreadId }) => Promise<RoutineAccess | null>

export const routineAccessOf = (args: {
  serveSession: CloudSession | null
  sessionStore: CloudSessionStore | null
  threads: ThreadStorePort
  clientVersion: string
}): RoutineAccessSource => {
  return async ({ threadId }) => {
    const session = args.serveSession ?? args.sessionStore?.read() ?? null
    if (session === null) return null
    const thread = await args.threads.find({ threadId })
    return {
      projectId: thread?.projectId ?? null,
      api: createHarnessApiClient({
        url: session.url,
        token: session.token,
        clientVersion: args.clientVersion,
        fetchFn: fetch,
      }),
    }
  }
}
