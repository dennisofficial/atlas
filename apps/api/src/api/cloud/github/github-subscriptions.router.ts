import {
  githubDismissAppInstallNoticeInputSchema,
  githubHeartbeatSchema,
  githubSubscribeInputSchema,
  githubSubscriptionIdInputSchema,
  githubSubscriptionSchema,
  type GithubDismissAppInstallNoticeInput,
  type GithubHeartbeat,
  type GithubSubscribeInput,
  type GithubSubscription,
  type GithubSubscriptionIdInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GithubSubscriptionsService } from '@dltech/atlas-github'

@Router({ alias: 'githubSubscriptions' })
@UseMiddlewares(SessionMiddleware)
export class GithubSubscriptionsRouter {
  constructor(private readonly subscriptions: GithubSubscriptionsService) {}

  @Mutation({
    input: githubSubscribeInputSchema,
    output: githubSubscriptionSchema,
  })
  subscribe(
    @Input() input: GithubSubscribeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<GithubSubscription> {
    return this.subscriptions.subscribe({
      userId: ctx.auth.userId,
      repoFullName: input.repoFullName,
      ...(input.prNumber === undefined ? {} : { prNumber: input.prNumber }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
    })
  }

  @Mutation({
    input: githubSubscriptionIdInputSchema,
    output: z.void(),
  })
  async unsubscribe(
    @Input() input: GithubSubscriptionIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.subscriptions.unsubscribe({ userId: ctx.auth.userId, subscriptionId: input.id })
  }

  @Mutation({
    input: githubDismissAppInstallNoticeInputSchema,
    output: z.void(),
  })
  async dismissAppInstallNotice(
    @Input() input: GithubDismissAppInstallNoticeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.subscriptions.dismissAppInstallNotice({
      userId: ctx.auth.userId,
      repoFullName: input.repoFullName,
    })
  }

  @Mutation({
    input: githubSubscriptionIdInputSchema,
    output: githubHeartbeatSchema,
  })
  heartbeat(
    @Input() input: GithubSubscriptionIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<GithubHeartbeat> {
    return this.subscriptions.heartbeat({
      userId: ctx.auth.userId,
      subscriptionId: input.id,
    })
  }
}
