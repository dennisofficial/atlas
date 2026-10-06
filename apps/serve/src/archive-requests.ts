import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'
import { EClientRequest } from '@dltech/atlas-harness'
import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isArchiveReadOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadSessionArchive || op === EClientRequest.ReadMemoryArchive

const refusal = (args: { frame: RequestFrame; error: unknown; kind: string }): ReplyFrame =>
  refusedRequest({
    replyTo: args.frame.id,
    message: args.error instanceof Error ? args.error.message : `the ${args.kind} archive failed`,
  })

export async function answerArchiveRead(args: {
  frame: RequestFrame
  sessionArchive: (() => Promise<SessionArchiveDescriptor | null>) | undefined
  memoryArchive: (() => Promise<Uint8Array | null>) | undefined
}): Promise<ReplyFrame> {
  const transcript = args.frame.op === EClientRequest.ReadSessionArchive
  const kind = transcript ? 'transcript' : 'memory'
  if (transcript ? args.sessionArchive === undefined : args.memoryArchive === undefined) {
    return refusedRequest({ replyTo: args.frame.id, message: `this serve has no ${kind} to read` })
  }
  try {
    if (transcript) {
      const archive = await args.sessionArchive?.()
      return answeredRequest({ replyTo: args.frame.id, data: { archive: archive ?? null } })
    }
    const bytes = await args.memoryArchive?.()
    return answeredRequest({
      replyTo: args.frame.id,
      data: { archive: bytes === null || bytes === undefined ? '' : Buffer.from(bytes).toString('base64') },
    })
  } catch (error) {
    return refusal({ frame: args.frame, error, kind })
  }
}
