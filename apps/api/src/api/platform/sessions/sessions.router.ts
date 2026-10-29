import {
  sessionsListInputSchema,
  wireSessionNodeSchema,
  type SessionsListInput,
  type WireSessionNode,
} from '@dltech/atlas-wire'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SessionsService } from './sessions.service'

@Router({ alias: 'sessions' })
@UseMiddlewares(SessionMiddleware)
export class SessionsRouter {
  constructor(private readonly sessions: SessionsService) {}

  @Query({
    input: sessionsListInputSchema,
    output: z.array(wireSessionNodeSchema),
    meta: meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } }),
  })
  list(@Input() input: SessionsListInput, @Ctx() ctx: SessionTrpcCtx): Promise<WireSessionNode[]> {
    return this.sessions.list({ userId: ctx.auth.userId, projectId: input.projectId })
  }
}
