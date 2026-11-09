import {
  hostExposePortInputSchema,
  hostExposePortOutputSchema,
  type HostExposePortInput,
  type HostExposePortOutput,
} from '@dltech/atlas-protocol'
import { db } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'
import { Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { HostTokenMiddleware } from './host-token.middleware'

const ownerOfV2Thread = async (threadId: string): Promise<string> => {
  const session = await db.orm.v2.V2Session.where({ mainThreadId: threadId })
    .select('userId')
    .first()
  if (session === null) throw new NotFoundException('thread not found')
  return session.userId
}

@Router({ alias: 'hostSelf' })
@UseMiddlewares(HostTokenMiddleware)
export class HostSelfRouter {
  constructor(private readonly previews: PreviewTunnelService) {}

  @Mutation({ input: hostExposePortInputSchema, output: hostExposePortOutputSchema })
  async exposePort(@Input() input: HostExposePortInput): Promise<HostExposePortOutput> {
    return this.previews.expose({
      threadId: input.threadId,
      userId: await ownerOfV2Thread(input.threadId),
      port: input.port,
    })
  }
}
