import { EClientRequest } from '@dltech/atlas-harness'
import type { GitChangesPort, TerminalPort } from '@dltech/atlas-harness'
import {
  readGitChangesParamsSchema,
  terminalCloseParamsSchema,
  terminalOpenParamsSchema,
  terminalResizeParamsSchema,
  terminalWriteParamsSchema,
} from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export type SessionTools = {
  changes?: GitChangesPort | undefined
  terminal?: TerminalPort | undefined
}

export const isSessionToolOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadGitChanges ||
  op === EClientRequest.TerminalOpen ||
  op === EClientRequest.TerminalWrite ||
  op === EClientRequest.TerminalResize ||
  op === EClientRequest.TerminalClose

const wanted = (args: { frame: RequestFrame; shape: string }): ReplyFrame =>
  refusedRequest({ replyTo: args.frame.id, message: `${args.frame.op} wants ${args.shape}` })

async function answerTerminal(args: {
  frame: RequestFrame
  terminal: TerminalPort
}): Promise<ReplyFrame> {
  const { frame, terminal } = args
  const replyTo = frame.id

  if (frame.op === EClientRequest.TerminalOpen) {
    const parsed = terminalOpenParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ cols, rows }' })
    return answeredRequest({ replyTo, data: await terminal.open(parsed.data) })
  }
  if (frame.op === EClientRequest.TerminalWrite) {
    const parsed = terminalWriteParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ terminalId, data }' })
    return answeredRequest({ replyTo, data: { done: await terminal.write(parsed.data) } })
  }
  if (frame.op === EClientRequest.TerminalResize) {
    const parsed = terminalResizeParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ terminalId, cols, rows }' })
    return answeredRequest({ replyTo, data: { done: await terminal.resize(parsed.data) } })
  }
  const parsed = terminalCloseParamsSchema.safeParse(frame.params)
  if (!parsed.success) return wanted({ frame, shape: '{ terminalId }' })
  return answeredRequest({ replyTo, data: { done: await terminal.close(parsed.data) } })
}

export async function answerSessionTool(args: {
  frame: RequestFrame
  tools: SessionTools
}): Promise<ReplyFrame> {
  const { frame, tools } = args

  if (frame.op === EClientRequest.ReadGitChanges) {
    if (tools.changes === undefined) {
      return refusedRequest({ replyTo: frame.id, message: 'this serve cannot read git changes' })
    }
    const parsed = readGitChangesParamsSchema.safeParse(frame.params)
    if (!parsed.success) return wanted({ frame, shape: '{ scope }' })
    return answeredRequest({ replyTo: frame.id, data: await tools.changes.read(parsed.data) })
  }

  if (tools.terminal === undefined) {
    return refusedRequest({ replyTo: frame.id, message: 'this serve has no terminal' })
  }
  return await answerTerminal({ frame, terminal: tools.terminal })
}
