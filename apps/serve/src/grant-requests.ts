import { toThreadId, type EventLogPort, type IdPort, type ThreadId } from '@dltech/atlas-core'
import { revokeGrant } from '@dltech/atlas-harness'
import { EClientRequest, revokeGrantParamsSchema } from '@dltech/atlas-wire'

import { messageOf } from './message-of'
import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export type ServeGrants = {
  log: Pick<EventLogPort, 'append' | 'read'>
  ids: Pick<IdPort, 'nextRunId'>
  changed: () => void
}

export const isGrantOp = (op: EClientRequest): boolean => op === EClientRequest.RevokeGrant

export async function answerGrantRequest(args: {
  frame: RequestFrame
  threadId: ThreadId
  grants: ServeGrants
}): Promise<ReplyFrame> {
  const { frame, threadId, grants } = args
  const parsed = revokeGrantParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'revoke-grant wants { threadId, grantId }',
    })
  }
  if (toThreadId(parsed.data.threadId) !== threadId) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'revoke-grant names a thread this serve does not hold',
    })
  }
  const revoked = await revokeGrant({
    log: grants.log,
    ids: grants.ids,
    threadId,
    grantId: parsed.data.grantId,
  })
  if (revoked) grants.changed()
  return answeredRequest({ replyTo: frame.id, data: { revoked } })
}

export const routeGrantRequest = (args: {
  frame: RequestFrame
  threadId: ThreadId
  grants: ServeGrants | undefined
  run: (work: () => Promise<ReplyFrame>) => Promise<ReplyFrame>
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, threadId, grants, run, reply } = args
  if (!isGrantOp(frame.op)) return false
  if (grants === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve holds no grants to revoke',
      }),
    )
    return true
  }
  void run(() => answerGrantRequest({ frame, threadId, grants }))
    .catch((error: unknown) =>
      refusedRequest({
        replyTo: frame.id,
        message: messageOf(error, 'the grant could not be revoked'),
      }),
    )
    .then(reply)
  return true
}
