import { rewindApplyParamsSchema, type RewindApplyParams } from '@dltech/atlas-wire/web'

import { EClientRequest } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel-types'

export async function requestRewindApply(args: {
  channel: Pick<RemoteDeltaChannel, 'request'>
  params: RewindApplyParams
}): Promise<void> {
  await args.channel.request({
    op: EClientRequest.Rewind,
    params: rewindApplyParamsSchema.parse(args.params),
  })
}
