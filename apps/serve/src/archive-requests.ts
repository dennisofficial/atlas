import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'
import { EClientRequest } from '@dltech/atlas-harness'
import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isArchiveReadOp = (op: EClientRequest): boolean => op === EClientRequest.ReadSessionArchive

export async function answerArchiveRead(args: {
  frame: RequestFrame
  sessionArchive: (() => Promise<SessionArchiveDescriptor | null>) | undefined
}): Promise<ReplyFrame> {
  if (args.sessionArchive === undefined) {
    return refusedRequest({ replyTo: args.frame.id, message: 'this serve has no transcript to read' })
  }
  try {
    const archive = await args.sessionArchive()
    return answeredRequest({ replyTo: args.frame.id, data: { archive } })
  } catch (error) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: error instanceof Error ? error.message : 'the transcript archive failed',
    })
  }
}
