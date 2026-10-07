import { projectDirectoryOf, type EventLogPort, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'

import { FileBrowser } from './file-browser'
import type { MentionReader } from './mention-reader'

export async function threadMentionFiles(args: {
  threadId: ThreadId
  log: Pick<EventLogPort, 'readOwn'>
  threads: Pick<ThreadStorePort, 'find'>
  launchDirectory: string
}): Promise<MentionReader> {
  const { threadId } = args
  const thread = await args.threads.find({ threadId })
  const root = projectDirectoryOf({
    events: await args.log.readOwn({ threadId }),
    launchDirectory: thread?.workspace ?? args.launchDirectory,
  })
  return new FileBrowser({ root })
}
