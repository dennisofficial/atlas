import {
  sandboxRolloverReplySchema,
  sandboxRolloverRequestSchema,
  type SandboxRolloverReply,
  type SandboxRolloverRequest,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  RetiredSandboxTokenMiddleware,
  type SandboxTrpcCtx,
} from '../../platform/sandboxes/retired-sandbox-token.middleware'
import { PodLaunchService } from './pod-launch.service'

@Router({ alias: 'sandboxRollover' })
@UseMiddlewares(RetiredSandboxTokenMiddleware)
export class SandboxRolloverRouter {
  constructor(private readonly pods: PodLaunchService) {}

  @Mutation({ input: sandboxRolloverRequestSchema, output: sandboxRolloverReplySchema })
  request(
    @Input() input: SandboxRolloverRequest,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<SandboxRolloverReply> {
    return this.pods.rollover({ threadId: ctx.sandbox.threadId, sessionId: input.sessionId })
  }
}
