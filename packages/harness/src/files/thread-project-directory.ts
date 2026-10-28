import { projectDirectoryOf, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'

export type ThreadDirectorySources = {
  threadId: ThreadId
  log: Pick<EventLogPort, 'readOwn'>
  threads: Pick<ThreadStorePort, 'find'>
  launchDirectory: string
}

export async function threadProjectDirectory(args: ThreadDirectorySources): Promise<string> {
  const thread = await args.threads.find({ threadId: args.threadId })
  return projectDirectoryOf({
    events: await args.log.readOwn({ threadId: args.threadId }),
    launchDirectory: thread?.workspace ?? args.launchDirectory,
  })
}
