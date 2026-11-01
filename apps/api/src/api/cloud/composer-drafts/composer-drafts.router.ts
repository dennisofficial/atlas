import {
  composerDraftClearInputSchema,
  composerDraftGetInputSchema,
  composerDraftGetReplySchema,
  composerDraftPutInputSchema,
  composerDraftSchema,
  type ComposerDraft,
  type ComposerDraftClearInput,
  type ComposerDraftGetInput,
  type ComposerDraftGetReply,
  type ComposerDraftPutInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ComposerDraftsService } from './composer-drafts.service'

const okReplySchema = z.object({ ok: z.literal(true) })

@Router({ alias: 'composerDrafts' })
export class ComposerDraftsRouter {
  constructor(private readonly drafts: ComposerDraftsService) {}

  @Mutation({ input: composerDraftPutInputSchema, output: composerDraftSchema })
  @UseMiddlewares(SessionMiddleware)
  put(@Input() input: ComposerDraftPutInput, @Ctx() ctx: SessionTrpcCtx): Promise<ComposerDraft> {
    return this.drafts.put({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: composerDraftGetInputSchema, output: composerDraftGetReplySchema })
  @UseMiddlewares(SessionMiddleware)
  get(
    @Input() input: ComposerDraftGetInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ComposerDraftGetReply> {
    return this.drafts
      .get({ userId: ctx.auth.userId, scope: input.scope })
      .then((draft) => ({ draft }))
  }

  @Mutation({ input: composerDraftClearInputSchema, output: okReplySchema })
  @UseMiddlewares(SessionMiddleware)
  async clear(
    @Input() input: ComposerDraftClearInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<{ ok: true }> {
    await this.drafts.clear({ userId: ctx.auth.userId, scope: input.scope })
    return { ok: true }
  }
}
