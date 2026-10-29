import {
  personalSecretDetailListSchema,
  personalSecretListSchema,
  personalSecretNameSchema,
  personalSecretNamesSchema,
  personalSecretSetSchema,
  type PersonalSecretDetailList,
  type PersonalSecretList,
  type PersonalSecretName,
  type PersonalSecretNames,
  type PersonalSecretSet,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { SecretsService } from './secrets.service'

@Router({ alias: 'secrets' })
export class SecretsRouter {
  constructor(private readonly secrets: SecretsService) {}

  @Query({
    output: personalSecretListSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async list(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<PersonalSecretList> {
    return { secrets: await this.secrets.list({ userId: ctx.auth.userId }) }
  }

  @Query({ output: personalSecretDetailListSchema })
  @UseMiddlewares(SessionMiddleware)
  async details(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalSecretDetailList> {
    return { secrets: await this.secrets.listDetails({ userId: ctx.auth.userId }) }
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
      kind: input.kind,
    })
  }

  @Mutation({ input: personalSecretNameSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: PersonalSecretName, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.secrets.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
