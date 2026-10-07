import type { ThreadId } from '@dltech/atlas-core'

import { refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import { answerRewind } from './rewind-apply'
import type { ServeRewind } from './serve-app'
import type { ServeTurnDriver } from './turn-driver'

export async function answerRewindRequest(args: {
  frame: RequestFrame
  threadId: ThreadId
  driver: ServeTurnDriver
  rewind: ServeRewind | undefined
}): Promise<ReplyFrame> {
  const { rewind, frame, threadId, driver } = args
  if (rewind === undefined) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'this serve has nothing a rewind could cut',
    })
  }
  try {
    return await answerRewind({
      frame,
      threadId,
      target: rewind.target,
      driver,
      ...(rewind.truncate === undefined ? {} : { truncate: { truncate: rewind.truncate } }),
    })
  } catch (error) {
    return refusedRequest({
      replyTo: frame.id,
      message: error instanceof Error ? error.message : 'the rewind cleanup failed',
    })
  }
}
