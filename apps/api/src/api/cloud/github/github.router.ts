import {
  githubConnectionStateSchema,
  githubDeviceCodesSchema,
  githubPollConnectInputSchema,
  githubPollResultSchema,
  githubTokenSchema,
  type GithubConnectionState,
  type GithubDeviceCodes,
  type GithubPollConnectInput,
  type GithubPollResult,
  type GithubToken,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GithubService } from '@dltech/atlas-github'

import { GithubRedirectService } from './github-redirect.service'

@Router({ alias: 'github' })
@UseMiddlewares(SessionMiddleware)
export class GithubRouter {
  constructor(
    private readonly github: GithubService,
    private readonly redirects: GithubRedirectService,
  ) {}

  @Mutation({ output: z.strictObject({ url: z.string() }) })
  beginRedirect(@Ctx() ctx: SessionTrpcCtx): Promise<{ url: string }> {
    return this.redirects.begin({ userId: ctx.auth.userId })
  }

  @Mutation({ output: githubDeviceCodesSchema })
  beginConnect(): Promise<GithubDeviceCodes> {
    return this.github.beginConnect()
  }

  @Mutation({ input: githubPollConnectInputSchema, output: githubPollResultSchema })
  pollConnect(
    @Input() input: GithubPollConnectInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<GithubPollResult> {
    return this.github.pollConnect({ userId: ctx.auth.userId, deviceCode: input.deviceCode })
  }

  @Query({ output: githubConnectionStateSchema })
  get(@Ctx() ctx: SessionTrpcCtx): Promise<GithubConnectionState> {
    return this.github.read({ userId: ctx.auth.userId })
  }

  @Query({ output: githubTokenSchema })
  token(@Ctx() ctx: SessionTrpcCtx): Promise<GithubToken> {
    return this.github.readToken({ userId: ctx.auth.userId })
  }

  @Mutation({ output: z.void() })
  async disconnect(@Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.github.disconnect({ userId: ctx.auth.userId })
  }
}
