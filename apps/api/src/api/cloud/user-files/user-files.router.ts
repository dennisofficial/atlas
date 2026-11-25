import {
  userFilePutRequestSchema,
  userFileRemoveRequestSchema,
  userFileRevisionSchema,
  userFilesGetReplySchema,
  userFilesGetRequestSchema,
  userFilesListReplySchema,
  userFilesListRequestSchema,
  type UserFilePutRequest,
  type UserFileRemoveRequest,
  type UserFileRevision,
  type UserFilesGetRequest,
  type UserFilesListRequest,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import type { SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { UserFilesService } from './user-files.service'
import type { UserFileContentListDto, UserFileListDto } from './user-files.types'

@Router({ alias: 'userFiles' })
@UseMiddlewares(SessionMiddleware)
export class UserFilesRouter {
  constructor(private readonly files: UserFilesService) {}

  @Query({
    input: userFilesListRequestSchema,
    output: userFilesListReplySchema,
  })
  async list(
    @Input() input: UserFilesListRequest,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<UserFileListDto> {
    const files = await this.files.list({
      userId: ctx.auth.userId,
      tree: input.tree,
      sinceRevision: input.sinceRevision,
    })
    return { files }
  }

  @Mutation({
    input: userFilesGetRequestSchema,
    output: userFilesGetReplySchema,
  })
  async get(
    @Input() input: UserFilesGetRequest,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<UserFileContentListDto> {
    const files = await this.files.getMany({
      userId: ctx.auth.userId,
      tree: input.tree,
      paths: input.paths,
    })
    return { files }
  }

  @Mutation({
    input: userFilePutRequestSchema,
    output: userFileRevisionSchema,
  })
  put(@Input() input: UserFilePutRequest, @Ctx() ctx: SessionTrpcCtx): Promise<UserFileRevision> {
    return this.files.put({
      userId: ctx.auth.userId,
      tree: input.tree,
      path: input.path,
      content: input.content,
      contentHash: input.contentHash,
      baseRevision: input.baseRevision ?? 0,
    })
  }

  @Mutation({
    input: userFileRemoveRequestSchema,
    output: userFileRevisionSchema,
  })
  remove(
    @Input() input: UserFileRemoveRequest,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<UserFileRevision> {
    return this.files.remove({
      userId: ctx.auth.userId,
      tree: input.tree,
      path: input.path,
      baseRevision: input.baseRevision,
    })
  }
}
