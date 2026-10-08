import {
  EClientRequest,
  confirmWorkspaceCleanupParamsSchema,
  type ConfirmWorkspaceCleanupReply,
  type ActivateSessionReply,
  type ApplyWorkspaceArchiveReply,
} from '@dltech/atlas-harness'

import type { WorkspacePreparer } from './archive-progress'
import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export const isWorkspaceTransferOp = (op: EClientRequest): boolean =>
  op === EClientRequest.PrepareWorkspaceArchive ||
  op === EClientRequest.ConfirmWorkspaceCleanup ||
  op === EClientRequest.ApplyWorkspaceArchive ||
  op === EClientRequest.ActivateSession

export async function answerWorkspaceTransfer(args: {
  frame: RequestFrame
  busy: () => boolean
  prepare?: WorkspacePreparer | undefined
  apply?: (() => Promise<ApplyWorkspaceArchiveReply | null>) | undefined
  activate?: (() => Promise<ActivateSessionReply>) | undefined
  confirmCleanup?: ((args: { generation: string }) => Promise<ConfirmWorkspaceCleanupReply>) | undefined
}): Promise<ReplyFrame> {
  const { frame } = args
  if (frame.op === EClientRequest.ConfirmWorkspaceCleanup) {
    const parsed = confirmWorkspaceCleanupParamsSchema.safeParse(frame.params)
    if (!parsed.success || args.confirmCleanup === undefined) return refusedRequest({ replyTo: frame.id, message: 'this serve cannot verify the requested cleanup generation' })
    if (args.busy()) return refusedRequest({ replyTo: frame.id, message: 'a turn is running, so the source cannot be removed' })
    try {
      return answeredRequest({ replyTo: frame.id, data: await args.confirmCleanup(parsed.data) })
    } catch (error) {
      return refusedRequest({ replyTo: frame.id, message: error instanceof Error ? error.message : 'source cleanup verification failed' })
    }
  }
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
