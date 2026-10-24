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
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from './session-or-sandbox.middleware'
import type { TurnDto } from './sessions.types'
import { TurnsService } from './turns.service'

const readMeta = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

@Router({ alias: 'threadTurns' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ThreadTurnsRouter {
  constructor(private readonly turns: TurnsService) {}

  @Mutation({ input: recordTurnInputSchema, output: z.void(), meta: readMeta })
  async record(
    @Input() input: RecordTurnInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    const { threadId, runId, ...draft } = input
    await this.turns.record({ userId: ctx.auth.userId, threadId, runId, draft })
  }

  @Query({ input: threadIdInputSchema, output: turnTreeSchema, meta: readMeta })
  tree(@Input() input: ThreadIdInput, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<TurnTree> {
    return this.turns.forThreadTree({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Query({ input: threadIdInputSchema, output: z.array(wireTurnSchema), meta: readMeta })
  list(@Input() input: ThreadIdInput, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<TurnDto[]> {
    return this.turns.forThread({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}
