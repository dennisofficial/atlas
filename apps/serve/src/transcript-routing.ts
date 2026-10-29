import type { ThreadId } from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-harness'

import { messageOf } from './message-of'
import { refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import {
  answerTranscriptRead,
  answerTranscriptWrite,
  isTranscriptReadOp,
  isTranscriptWriteOp,
  type TranscriptReaders,
} from './requests'
import type { ServeLog } from './serve-log'
import type { ThreadModelPersister } from './serve-thread-model-persist'

export const routeTranscriptRead = (args: {
  frame: RequestFrame
  transcript: TranscriptReaders | undefined
  threadId: ThreadId
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, transcript, threadId, reply } = args
  if (!isTranscriptReadOp(frame.op)) return false
  if (transcript === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve has no transcript to read',
      }),
    )
    return true
  }
  void answerTranscriptRead({ frame, transcript, threadId })
    .then(reply)
    .catch((error: unknown) =>
      reply({
        kind: EServeFrame.Reply,
        replyTo: frame.id,
        ok: false,
        data: { message: messageOf(error, 'the transcript read failed') },
      }),
    )
  return true
}

export const routeTranscriptWrite = (args: {
  frame: RequestFrame
  transcript: TranscriptReaders | undefined
  threadId: ThreadId
  log: ServeLog
  selectModel: ((model: { ref: string; effort: string }) => void) | undefined
  persistModel: ThreadModelPersister | undefined
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, transcript, threadId, log, selectModel, persistModel, reply } = args
  if (!isTranscriptWriteOp(frame.op)) return false
  if (transcript === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve has no transcript to write',
      }),
    )
    return true
  }
  void answerTranscriptWrite({
    frame,
    transcript,
    threadId,
    log,
    ...(selectModel === undefined ? {} : { select: selectModel }),
    ...(persistModel === undefined ? {} : { persist: persistModel }),
  })
    .then(reply)
    .catch((error: unknown) =>
      reply({
        kind: EServeFrame.Reply,
        replyTo: frame.id,
        ok: false,
        data: { message: messageOf(error, 'the transcript write failed') },
      }),
    )
  return true
}
