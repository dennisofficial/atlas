import {
  personalFileMountContentsSchema,
  personalFileMountKeySchema,
  personalFileMountListSchema,
  personalFileMountSetSchema,
  type PersonalFileMountContents,
  type PersonalFileMountKey,
  type PersonalFileMountList,
  type PersonalFileMountSetInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { assertFreshSession } from '../../../_module/session/fresh-session'
import { UserFileMountsService } from './user-file-mounts.service'

@Router({ alias: 'personalFileMounts' })
@UseMiddlewares(SessionMiddleware)
export class UserFileMountsRouter {
  constructor(private readonly mounts: UserFileMountsService) {}

  @Query({ output: personalFileMountListSchema })
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<PersonalFileMountList> {
    return { mounts: await this.mounts.list({ userId: ctx.auth.userId }) }
  }

  @Query({ input: personalFileMountKeySchema, output: personalFileMountContentsSchema })
  async reveal(
    @Input() input: PersonalFileMountKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<PersonalFileMountContents> {
    assertFreshSession({ auth: ctx.auth })
    const contents = await this.mounts.reveal({ userId: ctx.auth.userId, ...input })
    return { contents }
  }

  @Mutation({ input: personalFileMountSetSchema, output: z.void() })
  async set(@Input() input: PersonalFileMountSetInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.mounts.set({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: personalFileMountKeySchema, output: z.void() })
  async remove(@Input() input: PersonalFileMountKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.mounts.remove({ userId: ctx.auth.userId, ...input })
  }
}
