import type { ThreadId } from '@dltech/atlas-core'
import { SessionsClient, type ThreadStorePort } from '@dltech/atlas-harness'

import { EServeEvent, type ServeLog } from './serve-log'

export function forwardRenamesToApi(args: {
  threads: Pick<ThreadStorePort, 'onRename'>
  remote: { controlPlaneUrl: string; token: string; clientVersion: string; fetchFn: typeof fetch }
  log: ServeLog
}): () => void {
  const client = new SessionsClient({
    url: args.remote.controlPlaneUrl,
    token: args.remote.token,
    clientVersion: args.remote.clientVersion,
    fetchFn: args.remote.fetchFn,
  })
  return args.threads.onRename(({ threadId, title }: { threadId: ThreadId; title: string }) => {
    client.renameThread({ threadId, title }).catch((failure: unknown) => {
      args.log({
        event: EServeEvent.RenameForwardFailed,
        threadId,
        error: failure instanceof Error ? failure.message : String(failure),
      })
    })
  })
}
