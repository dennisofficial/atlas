import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import {
  DeleteUserFileDto,
  GetUserFilesDto,
  ListUserFilesQuery,
  PutUserFileDto,
} from './user-files.dto'
import { UserFilesService } from './user-files.service'
import type {
  UserFileContentListDto,
  UserFileListDto,
  UserFileRevisionDto,
} from './user-files.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

function pathOf(param: string | string[]): string {
  return Array.isArray(param) ? param.join('/') : param
}

@Controller({ path: 'user-files', version: '1' })
@UseGuards(SessionOrSandboxGuard)
@SandboxReachable()
export class UserFilesController {
  constructor(private readonly files: UserFilesService) {}

  @Get()
  async handleList(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListUserFilesQuery,
  ): Promise<UserFileListDto> {
    const files = await this.files.list({
      userId: userIdOf(request),
      tree: query.tree,
      sinceRevision: query.sinceRevision,
    })
    return { files }
  }

  @Post('get')
  @HttpCode(200)
  async handleGet(
    @Req() request: AuthenticatedRequest,
    @Body() body: GetUserFilesDto,
  ): Promise<UserFileContentListDto> {
    const files = await this.files.getMany({
      userId: userIdOf(request),
      tree: body.tree,
      paths: body.paths,
    })
    return { files }
  }

  @Put(':tree/*path')
  async handlePut(
    @Req() request: AuthenticatedRequest,
    @Param('tree') tree: string,
    @Param('path') path: string | string[],
    @Body() body: PutUserFileDto,
  ): Promise<UserFileRevisionDto> {
    return this.files.put({
      userId: userIdOf(request),
      tree,
      path: pathOf(path),
      content: body.content,
      contentHash: body.contentHash,
      baseRevision: body.baseRevision ?? 0,
    })
  }

  @Delete(':tree/*path')
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('tree') tree: string,
    @Param('path') path: string | string[],
    @Body() body: DeleteUserFileDto,
  ): Promise<UserFileRevisionDto> {
    return this.files.remove({
      userId: userIdOf(request),
      tree,
      path: pathOf(path),
      baseRevision: body.baseRevision,
    })
  }
}
