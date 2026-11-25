import {
  recordTurnInputSchema,
  threadIdInputSchema,
  turnTreeSchema,
  wireTurnSchema,
  type RecordTurnInput,
  type ThreadIdInput,
  type TurnTree,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import type { TurnDto } from './sessions.types'
import { TurnsService } from './turns.service'

const readMeta = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

@Router({ alias: 'threadTurns' })
@UseMiddlewares(SessionMiddleware)
export class ThreadTurnsRouter {
  constructor(private readonly turns: TurnsService) {}

  @Mutation({ input: recordTurnInputSchema, output: z.void(), meta: readMeta })
  async record(@Input() input: RecordTurnInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    const { threadId, runId, ...draft } = input
    await this.turns.record({
      userId: ctx.auth.userId,
      threadId,
      runId,
      draft,
    })
  }

  @Query({ input: threadIdInputSchema, output: turnTreeSchema, meta: readMeta })
  tree(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<TurnTree> {
    return this.turns.forThreadTree({
      userId: ctx.auth.userId,
      threadId: input.threadId,
    })
  }

  @Query({ input: threadIdInputSchema, output: z.array(wireTurnSchema), meta: readMeta })
  list(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<TurnDto[]> {
    return this.turns.forThread({
      userId: ctx.auth.userId,
      threadId: input.threadId,
    })
  }
}
