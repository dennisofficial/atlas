import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  mediaConfirmInputSchema,
  mediaConfirmOutputSchema,
  mediaPresignInputSchema,
  mediaPresignOutputSchema,
  mediaUrlInputSchema,
  mediaUrlOutputSchema,
  type MediaConfirmInput,
  type MediaConfirmOutput,
  type MediaPresignInput,
  type MediaPresignOutput,
  type MediaUrlInput,
  type MediaUrlOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { MediaService } from './media.service'

@Router({ alias: 'media' })
@UseMiddlewares(SessionMiddleware)
export class MediaRouter {
  constructor(private readonly media: MediaService) {}

  @Mutation({
    input: mediaPresignInputSchema,
    output: mediaPresignOutputSchema,
  })
  presign(
    @Input() input: MediaPresignInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<MediaPresignOutput> {
    return this.media.presign({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: mediaConfirmInputSchema,
    output: mediaConfirmOutputSchema,
  })
  confirm(
    @Input() input: MediaConfirmInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<MediaConfirmOutput> {
    return this.media.confirm({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: mediaUrlInputSchema, output: mediaUrlOutputSchema })
  url(@Input() input: MediaUrlInput, @Ctx() ctx: SessionTrpcCtx): Promise<MediaUrlOutput> {
    return this.media.url({ userId: ctx.auth.userId, ...input })
  }
}
