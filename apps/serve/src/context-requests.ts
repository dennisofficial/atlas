import {
  EClientRequest,
  listContextFilesParamsSchema,
  readContextFileParamsSchema,
} from '@dltech/atlas-harness'
import type { ContextBrowser } from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isContextOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ListContextFiles || op === EClientRequest.ReadContextFile

export type ContextReaders = Pick<ContextBrowser, 'list' | 'load'>

export async function answerContextRead(args: {
  frame: RequestFrame
  context: ContextReaders
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.ListContextFiles) {
    const parsed = listContextFilesParamsSchema.safeParse(args.frame.params ?? {})
    if (!parsed.success) {
      return refusedRequest({ replyTo: args.frame.id, message: 'list-context-files wants { directory? }' })
    }
    const entries = await args.context.list(parsed.data.directory)
    return answeredRequest({ replyTo: args.frame.id, data: { entries } })
  }

  const parsed = readContextFileParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: args.frame.id, message: 'read-context-file wants { path }' })
  }
  const file = await args.context.load(parsed.data.path)
  return answeredRequest({ replyTo: args.frame.id, data: { file } })
}
