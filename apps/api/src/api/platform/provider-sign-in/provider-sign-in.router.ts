import {
  accountDtoSchema,
  providerSignInBeginInputSchema,
  providerSignInBeginSchema,
  providerSignInCompleteInputSchema,
  providerSignInPollInputSchema,
  providerSignInPollSchema,
  type AccountDto,
  type ProviderSignInBegin,
  type ProviderSignInBeginInput,
  type ProviderSignInCompleteInput,
  type ProviderSignInPoll,
  type ProviderSignInPollInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { ProviderSignInService } from './provider-sign-in.service'

@Router({ alias: 'providerSignIn' })
@UseMiddlewares(SessionMiddleware)
export class ProviderSignInRouter {
  constructor(private readonly signIn: ProviderSignInService) {}

  @Mutation({
    input: providerSignInBeginInputSchema,
    output: providerSignInBeginSchema,
  })
  begin(
    @Input() input: ProviderSignInBeginInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProviderSignInBegin> {
    return this.signIn.begin({
      userId: ctx.auth.userId,
      provider: input.provider,
    })
  }

  @Mutation({
    input: providerSignInCompleteInputSchema,
    output: accountDtoSchema,
  })
  complete(
    @Input() input: ProviderSignInCompleteInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AccountDto> {
    return this.signIn.complete({
      userId: ctx.auth.userId,
      attemptId: input.attemptId,
      code: input.code,
    })
  }

  @Mutation({
    input: providerSignInPollInputSchema,
    output: providerSignInPollSchema,
    meta: meta({ throttle: { limit: 120, ttlMs: 60_000 } }),
  })
  poll(
    @Input() input: ProviderSignInPollInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProviderSignInPoll> {
    return this.signIn.poll({
      userId: ctx.auth.userId,
      attemptId: input.attemptId,
    })
  }
}
