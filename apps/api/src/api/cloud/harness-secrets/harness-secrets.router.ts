import {
  harnessSecretListSchema,
  harnessSecretNameSchema,
  harnessSecretNamesSchema,
  harnessSecretSetSchema,
  type HarnessSecretList,
  type HarnessSecretName,
  type HarnessSecretNames,
  type HarnessSecretSet,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { HarnessSecretsService } from './harness-secrets.service'

@Router({ alias: 'harnessSecrets' })
export class HarnessSecretsRouter {
  constructor(private readonly harnessSecrets: HarnessSecretsService) {}

  @Query({
    output: harnessSecretListSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<HarnessSecretList> {
    return { secrets: await this.harnessSecrets.list({ userId: ctx.auth.userId }) }
  }

  @Query({ output: harnessSecretNamesSchema })
  @UseMiddlewares(SessionMiddleware)
  async names(@Ctx() ctx: SessionTrpcCtx): Promise<HarnessSecretNames> {
    return { names: await this.harnessSecrets.listNames({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: harnessSecretSetSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async set(@Input() input: HarnessSecretSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.harnessSecrets.set({
      userId: ctx.auth.userId,
      name: input.name,
      value: input.value,
    })
  }

  @Mutation({ input: harnessSecretNameSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: HarnessSecretName, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.harnessSecrets.remove({ userId: ctx.auth.userId, name: input.name })
  }
}
