import {
  sessionDraftClearInputSchema,
  sessionDraftClearOutputSchema,
  sessionDraftGetInputSchema,
  sessionDraftGetOutputSchema,
  sessionDraftPutInputSchema,
  sessionDraftSchema,
  type SessionDraft,
  type SessionDraftClearInput,
  type SessionDraftClearOutput,
  type SessionDraftGetInput,
  type SessionDraftGetOutput,
  type SessionDraftPutInput,
} from '@dltech/atlas-protocol'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SessionDraftsService } from './session-drafts.service'

@Router({ alias: 'sessionDrafts' })
@UseMiddlewares(SessionMiddleware)
export class SessionDraftsRouter {
  constructor(private readonly drafts: SessionDraftsService) {}

  @Mutation({ input: sessionDraftPutInputSchema, output: sessionDraftSchema })
  put(@Input() input: SessionDraftPutInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionDraft> {
    return this.drafts.put({ userId: ctx.auth.userId, input })
  }

  @Query({ input: sessionDraftGetInputSchema, output: sessionDraftGetOutputSchema })
  async get(
    @Input() input: SessionDraftGetInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionDraftGetOutput> {
    return { draft: await this.drafts.get({ userId: ctx.auth.userId, input }) }
  }

  @Mutation({ input: sessionDraftClearInputSchema, output: sessionDraftClearOutputSchema })
  async clear(
    @Input() input: SessionDraftClearInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionDraftClearOutput> {
    await this.drafts.clear({ userId: ctx.auth.userId, input })
    return { ok: true }
  }
}
