import {
  userVercelCredentialSchema,
  userVercelCredentialUpsertSchema,
  vercelChooseProjectSchema,
  vercelConnectStartSchema,
  vercelProjectsListSchema,
  type UserVercelCredential,
  type UserVercelCredentialUpsert,
  type VercelChooseProject,
  type VercelConnectStart,
  type VercelProjectsList,
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

  @Mutation({ output: vercelConnectStartSchema })
  connectStart(@Ctx() ctx: SessionTrpcCtx): Promise<VercelConnectStart> {
    return this.vercel.connectStart({ userId: ctx.auth.userId })
  }

  @Mutation({ output: userVercelCredentialSchema })
  refreshPlan(@Ctx() ctx: SessionTrpcCtx): Promise<UserVercelCredential> {
    return this.vercel.refreshPlan({ userId: ctx.auth.userId })
  }

  @Query({ output: vercelProjectsListSchema })
  async projects(@Ctx() ctx: SessionTrpcCtx): Promise<VercelProjectsList> {
    return { projects: await this.vercel.projects({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: vercelChooseProjectSchema, output: userVercelCredentialSchema })
  chooseProject(
    @Input() input: VercelChooseProject,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<UserVercelCredential> {
    return this.vercel.chooseProject({
      userId: ctx.auth.userId,
      vercelProjectId: input.vercelProjectId,
    })
  }
}
