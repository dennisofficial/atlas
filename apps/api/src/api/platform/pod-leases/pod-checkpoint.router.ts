import {
  readRuntimeCheckpointReplySchema,
  sandboxThreadInputSchema,
  type ReadRuntimeCheckpointReply,
  type SandboxThreadInput,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { storedCheckpointOf } from '../sandboxes/sandbox-checkpoint'

@Router({ alias: 'localPodCheckpoint' })
export class LocalPodCheckpointRouter {
  @Query({
    input: sandboxThreadInputSchema,
    output: readRuntimeCheckpointReplySchema,
    meta: meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } }),
  })
  @UseMiddlewares(SessionMiddleware)
  async get(
    @Input() input: SandboxThreadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ReadRuntimeCheckpointReply> {
    const { threadId } = input
    const row = await db.orm.public.LocalPodCheckpoint.where({
      threadId,
      userId: ctx.auth.userId,
    })
      .select('checkpoint', 'revision')
      .first()
    if (row === null) throw new NotFoundException('local pod checkpoint not found')
    return {
      checkpoint: storedCheckpointOf({
        threadId,
        checkpoint: row.checkpoint,
        revision: row.revision,
      }),
    }
  }
}
