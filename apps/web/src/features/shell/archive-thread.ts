import { ERunner } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import { setLocalThreadArchived } from '@/features/desktop/desktop-wire'
import { archiveV2Session } from '@/features/sessions/data/sessions-api'
import { setThreadArchived } from '@/features/threads/data/threads-api'

export function archiveThread(args: {
  threadId: string
  archived: boolean
  runner?: WireThread['runner']
  v2?: boolean
}): Promise<unknown> {
  const { threadId, archived } = args
  if (args.v2 === true) return archiveV2Session({ sessionId: threadId, archived })
  return args.runner === ERunner.Local
    ? setLocalThreadArchived({ threadId, archived })
    : setThreadArchived({ threadId, archived })
}
