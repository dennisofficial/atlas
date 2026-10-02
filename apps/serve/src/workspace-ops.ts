import {
  EClientRequest,
  type ActivateSessionReply,
  type ApplyWorkspaceArchiveReply,
  type PrepareWorkspaceArchiveReply,
} from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isWorkspaceTransferOp = (op: EClientRequest): boolean =>
  op === EClientRequest.PrepareWorkspaceArchive ||
  op === EClientRequest.ApplyWorkspaceArchive ||
  op === EClientRequest.ActivateSession

export async function answerWorkspaceTransfer(args: {
  frame: RequestFrame
  busy: () => boolean
  prepare?: (() => Promise<PrepareWorkspaceArchiveReply>) | undefined
  apply?: (() => Promise<ApplyWorkspaceArchiveReply | null>) | undefined
  activate?: (() => Promise<ActivateSessionReply>) | undefined
}): Promise<ReplyFrame> {
  const { frame } = args
  const activating = frame.op === EClientRequest.ActivateSession
  const handler = activating
    ? args.activate
    : frame.op === EClientRequest.PrepareWorkspaceArchive
      ? args.prepare
      : args.apply
  if (handler === undefined) {
    return refusedRequest({ replyTo: frame.id, message: 'this serve cannot transfer a workspace' })
  }
  if (!activating && args.busy()) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'a turn is running, so the workspace cannot be transferred',
    })
  }
  try {
    const data = await handler()
    if (data === null) {
      return refusedRequest({ replyTo: frame.id, message: 'the drive holds no workspace archive' })
    }
    return answeredRequest({ replyTo: frame.id, data })
  } catch (error) {
    return refusedRequest({
      replyTo: frame.id,
      message: error instanceof Error ? error.message : 'the workspace transfer failed',
    })
  }
}
