import {
  claimSandboxInputSchema,
  sandboxAttachmentSchema,
  sandboxListEntrySchema,
  sandboxThreadInputSchema,
  type ClaimSandboxInput,
  type SandboxThreadInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SandboxesService } from './sandboxes.service'
import type { SandboxAttachmentDto, SandboxListEntryDto } from './sandboxes.types'

const clientRead = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })

@Router({ alias: 'sandboxes' })
@UseMiddlewares(SessionMiddleware)
export class SandboxesRouter {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Query({ output: z.array(sandboxListEntrySchema), meta: clientRead })
  list(@Ctx() ctx: SessionTrpcCtx): Promise<SandboxListEntryDto[]> {
    return this.sandboxes.list({ userId: ctx.auth.userId })
  }

  @Mutation({ input: claimSandboxInputSchema, output: sandboxAttachmentSchema, meta: clientRead })
  claim(
    @Input() input: ClaimSandboxInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SandboxAttachmentDto> {
    return this.sandboxes.claim({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      gitToken: input.gitToken,
      contextPending: input.contextPending,
      clientToken: input.clientToken,
      serveUrl: input.serveUrl,
      serveVersion: input.serveVersion,
      metadata: input.metadata,
    })
  }

  @Mutation({ input: sandboxThreadInputSchema, output: z.void(), meta: clientRead })
  destroy(@Input() input: SandboxThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.sandboxes.destroy({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}
