import { ERunner } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import { setLocalThreadArchived } from '@/features/desktop/desktop-wire'
import { setThreadArchived } from '@/features/threads/data/threads-api'

export function archiveThread(args: {
  threadId: string
  archived: boolean
  runner?: WireThread['runner']
}): Promise<unknown> {
  const { threadId, archived } = args
  return args.runner === ERunner.Local
    ? setLocalThreadArchived({ threadId, archived })
    : setThreadArchived({ threadId, archived })
}
