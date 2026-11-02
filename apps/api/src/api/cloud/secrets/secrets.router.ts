import {
  personalSecretSummaryListSchema,
  personalSecretValueSchema,
  personalSecretNameSchema,
  personalSecretNamesSchema,
  personalSecretSetSchema,
  type PersonalSecretSummaryList,
  type PersonalSecretValue,
  type PersonalSecretName,
  type PersonalSecretNames,
  type PersonalSecretSet,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { assertFreshSession } from '../../../_module/session/fresh-session'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { SecretsService } from './secrets.service'

@Router({ alias: 'secrets' })
export class SecretsRouter {
  constructor(private readonly secrets: SecretsService) {}

  @Query({ output: personalSecretSummaryListSchema, meta: meta({ sandboxReachable: true }) })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async details(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<PersonalSecretSummaryList> {
    return { secrets: await this.secrets.listSummaries({ userId: ctx.auth.userId }) }
  }

  @Query({
    input: personalSecretNameSchema,
    output: personalSecretValueSchema,
    meta: meta({ sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async reveal(
    @Input() input: PersonalSecretName,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<PersonalSecretValue> {
    if (ctx.sandbox === undefined) assertFreshSession({ auth: ctx.auth })
    return { value: await this.secrets.reveal({ userId: ctx.auth.userId, name: input.name }) }
  }

  @Query({ output: personalSecretNamesSchema })
  @UseMiddlewares(SessionMiddleware)
  async names(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalSecretNames> {
    return { names: await this.secrets.listNames({ userId: ctx.auth.userId }) }
  }

  @Mutation({
    input: personalSecretSetSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async set(@Input() input: PersonalSecretSet, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<void> {
    await this.secrets.set({
      userId: ctx.auth.userId,
      name: input.name,
      value: input.value,
    })
  }

  @Mutation({
    input: personalSecretNameSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async remove(
    @Input() input: PersonalSecretName,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.secrets.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
