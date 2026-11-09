import {
  hostExposePortInputSchema,
  hostExposePortOutputSchema,
  type HostExposePortInput,
  type HostExposePortOutput,
} from '@dltech/atlas-protocol'
import { Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { v2ThreadOwnerOf } from '../sandboxes/v2-thread-owner'
import { HostTokenMiddleware } from './host-token.middleware'

@Router({ alias: 'hostSelf' })
@UseMiddlewares(HostTokenMiddleware)
export class HostSelfRouter {
  constructor(private readonly previews: PreviewTunnelService) {}

  @Mutation({ input: hostExposePortInputSchema, output: hostExposePortOutputSchema })
  async exposePort(@Input() input: HostExposePortInput): Promise<HostExposePortOutput> {
    return this.previews.expose({
      threadId: input.threadId,
      userId: (await v2ThreadOwnerOf(input.threadId)).userId,
      port: input.port,
    })
  }
}
