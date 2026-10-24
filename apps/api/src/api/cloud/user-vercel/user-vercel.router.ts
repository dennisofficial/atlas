import {
  userVercelCredentialSchema,
  userVercelCredentialUpsertSchema,
  type UserVercelCredential,
  type UserVercelCredentialUpsert,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { UserVercelService } from './user-vercel.service'

@Router({ alias: 'userVercel' })
@UseMiddlewares(SessionMiddleware)
export class UserVercelRouter {
  constructor(private readonly vercel: UserVercelService) {}

  @Query({ output: userVercelCredentialSchema })
  get(@Ctx() ctx: SessionTrpcCtx): Promise<UserVercelCredential> {
    return this.vercel.read({ userId: ctx.auth.userId })
  }

  @Mutation({ input: userVercelCredentialUpsertSchema, output: z.void() })
  async save(
    @Input() input: UserVercelCredentialUpsert,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.vercel.write({ userId: ctx.auth.userId, input })
  }

  @Mutation({ output: z.void() })
  async remove(@Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.vercel.remove({ userId: ctx.auth.userId })
  }
}
