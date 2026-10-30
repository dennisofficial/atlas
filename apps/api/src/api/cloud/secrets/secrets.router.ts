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
import { SecretsService } from './secrets.service'

@Router({ alias: 'secrets' })
export class SecretsRouter {
  constructor(private readonly secrets: SecretsService) {}

  @Query({ output: personalSecretSummaryListSchema })
  @UseMiddlewares(SessionMiddleware)
  async details(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalSecretSummaryList> {
    return { secrets: await this.secrets.listSummaries({ userId: ctx.auth.userId }) }
  }

  @Query({ input: personalSecretNameSchema, output: personalSecretValueSchema })
  @UseMiddlewares(SessionMiddleware)
  async reveal(
    @Input() input: PersonalSecretName,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<PersonalSecretValue> {
    assertFreshSession({ auth: ctx.auth })
    return { value: await this.secrets.reveal({ userId: ctx.auth.userId, name: input.name }) }
  }

  @Query({ output: personalSecretNamesSchema })
  @UseMiddlewares(SessionMiddleware)
  async names(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalSecretNames> {
    return { names: await this.secrets.listNames({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: personalSecretSetSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async set(@Input() input: PersonalSecretSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.secrets.set({
      userId: ctx.auth.userId,
      name: input.name,
      value: input.value,
    })
  }

  @Mutation({ input: personalSecretNameSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: PersonalSecretName, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.secrets.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
