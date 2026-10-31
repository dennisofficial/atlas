import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  readActivityParamsSchema,
  readActivityReplySchema,
} from '@dltech/atlas-wire'
import type { SessionActivityPort } from '@dltech/atlas-harness/activity'
import type { ThreadStorePort } from '@dltech/atlas-harness'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'
import { familyThreadIdsOf } from './workspace-hooks'

export async function answerReadActivity(args: {
  frame: RequestFrame
  root: ThreadId
  activity: SessionActivityPort
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<ReplyFrame> {
  const { frame, root, activity, threads } = args
  const replyTo = frame.id
  const parsed = readActivityParamsSchema.safeParse(frame.params)
  if (!parsed.success)
    return refusedRequest({ replyTo, message: 'read-activity wants { threadId }' })

  const threadId = toThreadId(parsed.data.threadId)
  const family = await familyThreadIdsOf({ root, threads })
  if (!family.has(threadId)) {
    return refusedRequest({
      replyTo,
      message: `thread ${threadId} does not belong to this session`,
    })
  }
  return answeredRequest({
    replyTo,
    data: readActivityReplySchema.parse(await activity.read({ threadId })),
  })
}

export function routeActivityRead(args: {
  frame: RequestFrame
  root: ThreadId
  activity: SessionActivityPort
  threads: Pick<ThreadStorePort, 'spawned'> | undefined
  reply: (frame: ReplyFrame) => void
}): boolean {
  const { frame, activity, threads, reply } = args
  if (frame.op !== EClientRequest.ReadActivity) return false
  if (threads === undefined) {
    reply(refusedRequest({ replyTo: frame.id, message: 'this serve cannot read activity' }))
    return true
  }
  void answerReadActivity({ frame, root: args.root, activity, threads })
    .then(reply)
    .catch((error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: error instanceof Error ? error.message : 'the activity read failed',
        }),
      ),
    )
  return true
}
