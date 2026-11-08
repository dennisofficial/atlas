import {
  hostExposePortInputSchema,
  hostExposePortOutputSchema,
  type HostExposePortInput,
  type HostExposePortOutput,
} from '@dltech/atlas-protocol'
import { db } from '@dltech/atlas-db'
import { Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { sessionOfThread } from '../sessions/session-of-thread'
import { HostTokenMiddleware } from './host-token.middleware'

@Router({ alias: 'hostSelf' })
@UseMiddlewares(HostTokenMiddleware)
export class HostSelfRouter {
  constructor(private readonly previews: PreviewTunnelService) {}

  @Mutation({ input: hostExposePortInputSchema, output: hostExposePortOutputSchema })
  async exposePort(@Input() input: HostExposePortInput): Promise<HostExposePortOutput> {
    const session = await sessionOfThread({ reader: db, threadId: input.threadId })
    return this.previews.expose({
      threadId: input.threadId,
      userId: session.userId,
      port: input.port,
    })
  }
}
