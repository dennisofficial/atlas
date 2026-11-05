import type { ThreadId } from '@dltech/atlas-core'
import { EClientRequest, type DiagramRepairPort } from '@dltech/atlas-harness'
import { diagramRepairParamsSchema, type DiagramRepairReply } from '@dltech/atlas-wire'
import { toEventId } from '@dltech/atlas-core'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export const isDiagramRepairOp = (op: EClientRequest): boolean =>
  op === EClientRequest.RepairDiagram

export function createDiagramRepairRequests(args: {
  threadId: ThreadId
  diagramRepair: DiagramRepairPort | undefined
}) {
  const answer = async (frame: RequestFrame): Promise<ReplyFrame> => {
    const parsed = diagramRepairParamsSchema.safeParse(frame.params)
    if (!parsed.success)
      return refusedRequest({ replyTo: frame.id, message: 'invalid repair-diagram request' })
    const params = parsed.data
    if (params.threadId !== args.threadId)
      return refusedRequest({ replyTo: frame.id, message: 'this sandbox serves one thread' })
    if (args.diagramRepair === undefined)
      return refusedRequest({ replyTo: frame.id, message: 'this serve cannot repair diagrams' })

    try {
      const outcome: DiagramRepairReply = await args.diagramRepair.repair({
        threadId: args.threadId,
        messageId: toEventId(params.messageId),
        source: params.source,
        error: params.error,
      })
      return answeredRequest({ replyTo: frame.id, data: outcome })
    } catch (error) {
      return refusedRequest({
        replyTo: frame.id,
        message: error instanceof Error ? error.message : 'the diagram repair failed',
      })
    }
  }
  return { answer }
}
