import type { ThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

export abstract class SessionActivityPort {
  abstract read(args: { threadId: ThreadId }): Promise<ReadActivityReply>
}
