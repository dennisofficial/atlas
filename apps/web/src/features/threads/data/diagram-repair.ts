import {
  EClientRequest,
  type EClientRequest as ClientRequestOp,
} from '@dltech/atlas-client/channel'
import { diagramRepairReplySchema } from '@dltech/atlas-wire/web'

export const DIAGRAM_REPAIR_NEEDS_SANDBOX =
  'Fixing a diagram needs the sandbox — try again once it is live'

export type RepairDiagramAction = (args: {
  messageId: string
  chart: string
  error: string
}) => Promise<void>

export async function requestDiagramRepair(args: {
  request: (call: { op: ClientRequestOp; params: unknown }) => Promise<unknown>
  threadId: string
  messageId: string
  source: string
  error: string
}): Promise<string> {
  const reply = diagramRepairReplySchema.parse(
    await args.request({
      op: EClientRequest.RepairDiagram,
      params: {
        threadId: args.threadId,
        messageId: args.messageId,
        source: args.source,
        error: args.error,
      },
    }),
  )
  if (reply.kind === 'failed') throw new Error(reply.reason)
  return reply.repaired
}
