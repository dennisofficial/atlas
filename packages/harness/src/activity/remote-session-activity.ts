import type { ThreadId } from '@dltech/atlas-core'

import {
  ECapability,
  EClientRequest,
  readActivityReplySchema,
  type ReadActivityReply,
} from '../cloud/channel-wire'
import type { RemoteDeltaChannel } from '../cloud/remote-delta-channel'
import { SessionActivityPort } from './port'

export class RemoteSessionActivity extends SessionActivityPort {
  private readonly channel: Pick<RemoteDeltaChannel, 'capabilities' | 'requestIfConnected'>

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'capabilities' | 'requestIfConnected'> }) {
    super()
    this.channel = args.channel
  }

  async read(args: { threadId: ThreadId }): Promise<ReadActivityReply> {
    if (!this.channel.capabilities().has(ECapability.ReadActivity)) {
      throw new Error('this serve does not support activity reads')
    }
    const reply = this.channel.requestIfConnected?.({
      op: EClientRequest.ReadActivity,
      params: { threadId: args.threadId },
    })
    if (reply === undefined) throw new Error('activity is unavailable while disconnected')
    return readActivityReplySchema.parse(await reply)
  }
}
