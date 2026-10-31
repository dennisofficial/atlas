import type { ThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

import { SessionActivityPort } from './port'

export class UnavailableSessionActivity extends SessionActivityPort {
  async read(_args: { threadId: ThreadId }): Promise<ReadActivityReply> {
    throw new Error('Activity is unavailable from a local transcript copy')
  }
}
