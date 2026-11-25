import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { TRPCError } from '@trpc/server'
import {
  filesReadInputSchema,
  filesReadOutputSchema,
  filesSearchInputSchema,
  filesSearchOutputSchema,
  filesTreeInputSchema,
  filesTreeOutputSchema,
  type FilesReadInput,
  type FilesReadOutput,
  type FilesSearchInput,
  type FilesSearchOutput,
  type FilesTreeInput,
  type FilesTreeOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { FilesService } from './files.service'

@Router({ alias: 'files' })
@UseMiddlewares(SessionMiddleware)
export class FilesRouter {
  constructor(private readonly files: FilesService) {}

  private refuseBatched(ctx: SessionTrpcCtx): void {
    if (ctx.req.query.batch === '1') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'batched calls are not supported' })
    }
  }

  @Query({ input: filesTreeInputSchema, output: filesTreeOutputSchema })
  tree(@Input() input: FilesTreeInput, @Ctx() ctx: SessionTrpcCtx): Promise<FilesTreeOutput> {
    this.refuseBatched(ctx)
    return this.files.tree({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: filesSearchInputSchema, output: filesSearchOutputSchema })
  search(@Input() input: FilesSearchInput, @Ctx() ctx: SessionTrpcCtx): Promise<FilesSearchOutput> {
    this.refuseBatched(ctx)
    return this.files.search({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: filesReadInputSchema, output: filesReadOutputSchema })
  read(@Input() input: FilesReadInput, @Ctx() ctx: SessionTrpcCtx): Promise<FilesReadOutput> {
    this.refuseBatched(ctx)
    return this.files.read({ userId: ctx.auth.userId, ...input })
  }
}
