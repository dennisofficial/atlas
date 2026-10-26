import { EClientRequest, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { operatorInputReplySchema } from '@dltech/atlas-wire/web'

import { NOT_CONNECTED_NOTICE } from './queued-edit'

export const UNDELIVERED_NOTICE = "Atlas couldn't take that. Try again."

export async function submitOperatorInput(args: {
  channel: Pick<RemoteDeltaChannel, 'request'> | null
  requestId: string
  value: string
}): Promise<string | null> {
  if (args.channel === null) return NOT_CONNECTED_NOTICE
  try {
    const reply = operatorInputReplySchema.parse(
      await args.channel.request({
        op: EClientRequest.ProvideOperatorInput,
        params: { requestId: args.requestId, value: args.value },
      }),
    )
    return reply.delivered ? null : UNDELIVERED_NOTICE
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure)
  }
}
