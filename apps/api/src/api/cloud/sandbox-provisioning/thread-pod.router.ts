import {
  podConnectReplySchema,
  podStatusSchema,
  threadIdInputSchema,
  type PodConnectReply,
  type PodStatus,
  type ThreadIdInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ThreadPodService } from './thread-pod.service'

@Router({ alias: 'threadPod' })
@UseMiddlewares(SessionMiddleware)
export class ThreadPodRouter {
  constructor(private readonly pods: ThreadPodService) {}

  @Query({ input: threadIdInputSchema, output: podStatusSchema })
  status(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<PodStatus> {
    return this.pods.status({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Mutation({ input: threadIdInputSchema, output: podConnectReplySchema })
  connect(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<PodConnectReply> {
    return this.pods.connect({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}
