import type { ApiClient } from '@dltech/atlas-api-router'
import type { ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'

import { createHarnessApiClient } from './api-trpc-client'
import type { CloudSession } from './cloud-session'
import type { CloudSessionStore } from './cloud-session'

export type CloudConfigAccess = {
  client: ApiClient
  inSandbox: boolean
  projectId: string | null
}

export type CloudConfigAccessSource = (args: {
  threadId: ThreadId
}) => Promise<CloudConfigAccess | null>

export const cloudConfigAccessOf = (args: {
  serveSession: CloudSession | null
  sessionStore: CloudSessionStore | null
  threads: ThreadStorePort
  clientVersion: string
}): CloudConfigAccessSource => {
  const inSandbox = args.serveSession !== null
  return async ({ threadId }) => {
    const session = args.serveSession ?? args.sessionStore?.read() ?? null
    if (session === null) return null
    const thread = await args.threads.find({ threadId })
    return {
      inSandbox,
      projectId: thread?.projectId ?? null,
      client: createHarnessApiClient({
        url: session.url,
        token: session.token,
        clientVersion: args.clientVersion,
        fetchFn: fetch,
      }),
    }
  }
}
