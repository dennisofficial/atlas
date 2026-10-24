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
import { meta } from '../../../_module/trpc/procedure-meta'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import type { SessionOrSandboxTrpcCtx } from '../../platform/sessions/session-or-sandbox.middleware'
import { UserFilesService } from './user-files.service'
import type { UserFileContentListDto, UserFileListDto } from './user-files.types'

const SANDBOX_REACHABLE = meta({ sandboxReachable: true })

@Router({ alias: 'userFiles' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class UserFilesRouter {
  constructor(private readonly files: UserFilesService) {}

  @Query({
    input: userFilesListRequestSchema,
    output: userFilesListReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  async list(
    @Input() input: UserFilesListRequest,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
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
    meta: SANDBOX_REACHABLE,
  })
  async get(
    @Input() input: UserFilesGetRequest,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
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
    meta: SANDBOX_REACHABLE,
  })
  put(
    @Input() input: UserFilePutRequest,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<UserFileRevision> {
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
    meta: SANDBOX_REACHABLE,
  })
  remove(
    @Input() input: UserFileRemoveRequest,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<UserFileRevision> {
    return this.files.remove({
      userId: ctx.auth.userId,
      tree: input.tree,
      path: input.path,
      baseRevision: input.baseRevision,
    })
  }
}
