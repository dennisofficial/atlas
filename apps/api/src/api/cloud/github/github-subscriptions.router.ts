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
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { GithubSubscriptionsService } from './github-subscriptions.service'

const threadLinkOf = (ctx: SessionOrSandboxTrpcCtx): { threadId?: string } =>
  ctx.sandbox === undefined ? {} : { threadId: ctx.sandbox.threadId }

@Router({ alias: 'githubSubscriptions' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class GithubSubscriptionsRouter {
  constructor(private readonly subscriptions: GithubSubscriptionsService) {}

  @Mutation({
    input: githubSubscribeInputSchema,
    output: githubSubscriptionSchema,
    meta: meta({ sandboxReachable: true }),
  })
  subscribe(
    @Input() input: GithubSubscribeInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<GithubSubscription> {
    return this.subscriptions.subscribe({
      userId: ctx.auth.userId,
      repoFullName: input.repoFullName,
      ...(input.prNumber === undefined ? {} : { prNumber: input.prNumber }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...threadLinkOf(ctx),
    })
  }

  @Mutation({
    input: githubSubscriptionIdInputSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async unsubscribe(
    @Input() input: GithubSubscriptionIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.subscriptions.unsubscribe({ userId: ctx.auth.userId, subscriptionId: input.id })
  }

  @Mutation({
    input: githubDismissAppInstallNoticeInputSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async dismissAppInstallNotice(
    @Input() input: GithubDismissAppInstallNoticeInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.subscriptions.dismissAppInstallNotice({
      userId: ctx.auth.userId,
      repoFullName: input.repoFullName,
    })
  }

  @Mutation({
    input: githubSubscriptionIdInputSchema,
    output: githubHeartbeatSchema,
    meta: meta({ sandboxReachable: true }),
  })
  heartbeat(
    @Input() input: GithubSubscriptionIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<GithubHeartbeat> {
    return this.subscriptions.heartbeat({
      userId: ctx.auth.userId,
      subscriptionId: input.id,
      ...threadLinkOf(ctx),
    })
  }
}
