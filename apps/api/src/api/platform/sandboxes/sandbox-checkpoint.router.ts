import {
  readRuntimeCheckpointReplySchema,
  runtimeCheckpointSchema,
  sandboxThreadInputSchema,
  type ReadRuntimeCheckpointReply,
  type RuntimeCheckpoint,
  type SandboxThreadInput,
} from '@dltech/atlas-wire'
import { db, or, type Row } from '@dltech/atlas-db'
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { ThreadSignalsService } from '../sessions/thread-signals.service'
import { storedCheckpointOf } from './sandbox-checkpoint'
import { SandboxTokenMiddleware, type SandboxTrpcCtx } from './sandbox-token.middleware'
import { hashSessionToken } from './sandbox-tokens'
import { ETokenPrincipalKind } from './token-principal'

const CHECKPOINT_COLUMNS = ['userId', 'runtimeCheckpoint', 'runtimeCheckpointRevision'] as const

const clientRead = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

type CheckpointJson = Row<'CloudSandbox'>['runtimeCheckpoint']

const asCheckpointJson = (input: RuntimeCheckpoint): CheckpointJson =>
  JSON.parse(JSON.stringify(input)) as CheckpointJson

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
    meta: meta({ podReachable: true, ...clientRead }),
  })
  @UseMiddlewares(SandboxTokenMiddleware)
  async put(
    @Input() input: RuntimeCheckpoint,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<ReadRuntimeCheckpointReply> {
    if (input.threadId !== ctx.sandbox.threadId) {
      throw new ForbiddenException('a sandbox or pod token writes only its own thread')
    }
    const bearer = ctx.bearerToken
    if (bearer === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    if (ctx.sandbox.kind === ETokenPrincipalKind.Pod) {
      return this.putPodCheckpoint({ input, userId: ctx.sandbox.userId })
    }
    const { threadId, userId } = ctx.sandbox
    const revision = input.revision
    const updated = await db.orm.public.CloudSandbox.where({
      threadId,
      userId,
      tokenHash: hashSessionToken(bearer),
    })
      .where((row) =>
        or(row.runtimeCheckpointRevision.isNull(), row.runtimeCheckpointRevision.lt(revision)),
      )
      .updateAndCount({
        runtimeCheckpoint: asCheckpointJson(input),
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

  private async putPodCheckpoint(args: {
    input: RuntimeCheckpoint
    userId: string
  }): Promise<ReadRuntimeCheckpointReply> {
    const { input, userId } = args
    const { threadId, revision } = input
    const checkpoint = asCheckpointJson(input)
    const written = await db.transaction(async (tx) => {
      const thread = await tx.orm.public.Thread.where({ id: threadId, userId }).select('id').first()
      if (thread === null) throw new NotFoundException('thread not found')
      await tx.orm.public.LocalPodCheckpoint.upsert({
        create: { userId, threadId },
        update: { userId },
        conflictOn: { threadId },
      })
      return tx.orm.public.LocalPodCheckpoint.where({ threadId, userId })
        .where((row) => or(row.revision.isNull(), row.revision.lt(revision)))
        .updateAndCount({ checkpoint, revision, updatedAt: new Date() })
    })
    if (written === 1) {
      await this.signals.podChanged({ threadId })
      return { checkpoint: input }
    }

    const stored = await db.orm.public.LocalPodCheckpoint.where({ threadId, userId })
      .select('checkpoint', 'revision')
      .first()
    if (stored === null) throw new NotFoundException('local pod checkpoint not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: stored.checkpoint,
        revision: stored.revision,
      }),
    }
  }
}
