import {
  sandboxProvisionReplySchema,
  threadIdInputSchema,
  type SandboxProvisionReply,
  type ThreadIdInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SandboxProvisioningService } from './sandbox-provisioning.service'

@Router({ alias: 'threadSandbox' })
@UseMiddlewares(SessionMiddleware)
export class SandboxProvisioningRouter {
  constructor(private readonly provisioning: SandboxProvisioningService) {}

  @Mutation({ input: threadIdInputSchema, output: sandboxProvisionReplySchema })
  provision(
    @Input() input: ThreadIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SandboxProvisionReply> {
    return this.provisioning.provision({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}
