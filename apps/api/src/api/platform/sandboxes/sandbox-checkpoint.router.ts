import {
  readRuntimeCheckpointReplySchema,
  runtimeCheckpointSchema,
  sandboxThreadInputSchema,
  type ReadRuntimeCheckpointReply,
  type RuntimeCheckpoint,
  type SandboxThreadInput,
} from '@dltech/atlas-wire'
import { db, or, type Row } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { ThreadSignalsService } from '../sessions/thread-signals.service'
import { storedCheckpointOf } from './sandbox-checkpoint'
import {
  SandboxThreadTokenMiddleware,
  type SandboxThreadTrpcCtx,
} from './sandbox-thread-token.middleware'
import { hashSessionToken } from './sandbox-tokens'

const CHECKPOINT_COLUMNS = ['userId', 'runtimeCheckpoint', 'runtimeCheckpointRevision'] as const

const clientRead = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

@Router({ alias: 'sandboxCheckpoint' })
export class SandboxCheckpointRouter {
  constructor(private readonly signals: ThreadSignalsService) {}

  @Query({
    input: sandboxThreadInputSchema,
    output: readRuntimeCheckpointReplySchema,
    meta: clientRead,
  })
  @UseMiddlewares(SessionMiddleware)
  async get(
    @Input() input: SandboxThreadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ReadRuntimeCheckpointReply> {
    const { threadId } = input
    const row = await db.orm.public.CloudSandbox.where({ threadId, userId: ctx.auth.userId })
      .select(...CHECKPOINT_COLUMNS)
      .first()
    if (row === null) throw new NotFoundException('sandbox not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: row.runtimeCheckpoint,
        revision: row.runtimeCheckpointRevision,
      }),
    }
  }

  @Mutation({
    input: runtimeCheckpointSchema,
    output: readRuntimeCheckpointReplySchema,
    meta: clientRead,
  })
  @UseMiddlewares(SandboxThreadTokenMiddleware)
  async put(
    @Input() input: RuntimeCheckpoint,
    @Ctx() ctx: SandboxThreadTrpcCtx,
  ): Promise<ReadRuntimeCheckpointReply> {
    const { threadId, userId } = ctx.sandbox
    const revision = input.revision
    const updated = await db.orm.public.CloudSandbox.where({
      threadId,
      userId,
      tokenHash: hashSessionToken(ctx.bearerToken),
    })
      .where((row) =>
        or(row.runtimeCheckpointRevision.isNull(), row.runtimeCheckpointRevision.lt(revision)),
      )
      .updateAndCount({
        runtimeCheckpoint: JSON.parse(
          JSON.stringify(input),
        ) as Row<'CloudSandbox'>['runtimeCheckpoint'],
        runtimeCheckpointRevision: revision,
        updatedAt: new Date(),
      })
    if (updated === 1) {
      await this.signals.podChanged({ threadId })
      return { checkpoint: input }
    }

    const stored = await db.orm.public.CloudSandbox.where({ threadId, userId })
      .select(...CHECKPOINT_COLUMNS)
      .first()
    if (stored === null) throw new NotFoundException('sandbox not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: stored.runtimeCheckpoint,
        revision: stored.runtimeCheckpointRevision,
      }),
    }
  }
}
