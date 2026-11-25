import {
  accessGrantKeySchema,
  accessGrantLayeredInputSchema,
  accessGrantLayeredListSchema,
  accessGrantListInputSchema,
  accessGrantListSchema,
  accessGrantMoveSchema,
  accessGrantSaveSchema,
  accessGrantSavedSchema,
  type AccessGrantKey,
  type AccessGrantLayeredInput,
  type AccessGrantLayeredList,
  type AccessGrantList,
  type AccessGrantListInput,
  type AccessGrantMove,
  type AccessGrantSave,
  type AccessGrantSaved,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { AccessGrantsService } from './access-grants.service'

@Router({ alias: 'accessGrants' })
export class AccessGrantsRouter {
  constructor(private readonly grants: AccessGrantsService) {}

  @Query({ input: accessGrantListInputSchema, output: accessGrantListSchema })
  @UseMiddlewares(SessionMiddleware)
  async list(
    @Input() input: AccessGrantListInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AccessGrantList> {
    return { grants: await this.grants.list({ userId: ctx.auth.userId, scope: input.scope }) }
  }

  @Query({ input: accessGrantLayeredInputSchema, output: accessGrantLayeredListSchema })
  @UseMiddlewares(SessionMiddleware)
  async layered(
    @Input() input: AccessGrantLayeredInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AccessGrantLayeredList> {
    return this.grants.layers({ userId: ctx.auth.userId, scope: input.scope })
  }

  @Mutation({ input: accessGrantSaveSchema, output: accessGrantSavedSchema })
  @UseMiddlewares(SessionMiddleware)
  async save(
    @Input() input: AccessGrantSave,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AccessGrantSaved> {
    return this.grants.save({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: accessGrantMoveSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async moveMember(@Input() input: AccessGrantMove, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.grants.moveMember({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: accessGrantKeySchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: AccessGrantKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.grants.remove({ userId: ctx.auth.userId, scope: input.scope, id: input.id })
  }
}
