import { EClientRequest } from '@dltech/atlas-harness'
import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isArchiveReadOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadSessionArchive || op === EClientRequest.ReadMemoryArchive

export async function answerArchiveRead(args: {
  frame: RequestFrame
  sessionArchive: (() => Promise<Uint8Array | null>) | undefined
  memoryArchive: (() => Promise<Uint8Array | null>) | undefined
}): Promise<ReplyFrame> {
  const transcript = args.frame.op === EClientRequest.ReadSessionArchive
  const archive = transcript ? args.sessionArchive : args.memoryArchive
  const kind = transcript ? 'transcript' : 'memory'
  if (archive === undefined) {
    return refusedRequest({ replyTo: args.frame.id, message: `this serve has no ${kind} to read` })
  }
  try {
    const bytes = await archive()
    return answeredRequest({
      replyTo: args.frame.id,
      data: { archive: bytes === null ? '' : Buffer.from(bytes).toString('base64') },
    })
  } catch (error) {
    return refusedRequest({ replyTo: args.frame.id,
      message: error instanceof Error ? error.message : `the ${kind} archive failed` })
  }
}
