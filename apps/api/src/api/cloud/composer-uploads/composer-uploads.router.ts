import {
  composerUploadDiscardInputSchema,
  composerUploadDownloadInputSchema,
  composerUploadDownloadReplySchema,
  composerUploadPresignInputSchema,
  composerUploadPresignReplySchema,
  type ComposerUploadDiscardInput,
  type ComposerUploadDownloadInput,
  type ComposerUploadDownloadReply,
  type ComposerUploadPresignInput,
  type ComposerUploadPresignReply,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { ComposerUploadsService } from './composer-uploads.service'

@Router({ alias: 'composerUploads' })
export class ComposerUploadsRouter {
  constructor(private readonly uploads: ComposerUploadsService) {}

  @Mutation({
    input: composerUploadPresignInputSchema,
    output: composerUploadPresignReplySchema,
  })
  @UseMiddlewares(SessionMiddleware)
  presign(
    @Input() input: ComposerUploadPresignInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ComposerUploadPresignReply> {
    return this.uploads.presign({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: composerUploadDiscardInputSchema,
    output: z.object({ ok: z.literal(true) }),
  })
  @UseMiddlewares(SessionMiddleware)
  async discard(
    @Input() input: ComposerUploadDiscardInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<{ ok: true }> {
    await this.uploads.discard({
      userId: ctx.auth.userId,
      pathname: input.pathname,
    })
    return { ok: true }
  }

  @Mutation({
    input: composerUploadDownloadInputSchema,
    output: composerUploadDownloadReplySchema,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  download(
    @Input() input: ComposerUploadDownloadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ComposerUploadDownloadReply> {
    return this.uploads.download({ userId: ctx.auth.userId, ...input })
  }
}
