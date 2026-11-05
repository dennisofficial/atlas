import type { EventId, ThreadId } from '@dltech/atlas-core'
import {
  diagramRepairParamsSchema,
  diagramRepairReplySchema,
  ECapability,
} from '@dltech/atlas-wire'

import { DiagramRepairPort, type DiagramRepairOutcome } from '../diagrams/diagram-repair-port'
import { EClientRequest } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'

type DiagramRepairChannel = Pick<RemoteDeltaChannel, 'request' | 'capabilities'>

export class RemoteDiagramRepair extends DiagramRepairPort {
  private readonly channel: DiagramRepairChannel

  constructor(args: { channel: DiagramRepairChannel }) {
    super()
    this.channel = args.channel
  }

  async repair(args: {
    threadId: ThreadId
    messageId: EventId
    source: string
    error: string
    signal?: AbortSignal | undefined
  }): Promise<DiagramRepairOutcome> {
    if (!this.channel.capabilities().has(ECapability.DiagramRepair)) {
      return { kind: 'failed', reason: 'this serve cannot repair diagrams' }
    }
    const reply = diagramRepairReplySchema.parse(
      await this.channel.request({
        op: EClientRequest.RepairDiagram,
        params: diagramRepairParamsSchema.parse({
          threadId: args.threadId,
          messageId: args.messageId,
          source: args.source,
          error: args.error,
        }),
      }),
    )
    return reply
  }
}
