import { type ReportNotifyPresenceInput, reportNotifyPresenceInputSchema } from '@dltech/atlas-wire'
import { TRPCError } from '@trpc/server'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { PresenceRegistry } from './presence-registry'

@Router({ alias: 'notifications' })
@UseMiddlewares(SessionMiddleware)
export class NotificationsRouter {
  constructor(private readonly presence: PresenceRegistry) {}

  private refuseBatched(ctx: SessionTrpcCtx): void {
    if (ctx.req.query.batch === '1') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'batched calls are not supported' })
    }
  }

  @Mutation({ input: reportNotifyPresenceInputSchema, output: z.void() })
  async reportPresence(
    @Input() input: ReportNotifyPresenceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    this.refuseBatched(ctx)
    await this.presence.report({ userId: ctx.auth.userId, ...input })
  }
}
