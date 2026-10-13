import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import {
  DeleteUserFileDto,
  GetUserFilesDto,
  ListUserFilesQuery,
  PutUserFileDto,
  StreamUserFilesQuery,
} from './user-files.dto'
import { UserFilesFanoutService } from './user-files.fanout'
import { UserFilesService } from './user-files.service'
import {
  EUserFileEvent,
  type UserFileContentListDto,
  type UserFileListDto,
  type UserFileRevisionDto,
} from './user-files.types'

const HEARTBEAT_INTERVAL_MS = 30_000

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
  constructor(
    private readonly files: UserFilesService,
    private readonly fanout: UserFilesFanoutService,
    private readonly drain: DrainStateService,
  ) {}

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

  @Sse('stream')
  handleStream(
    @Req() request: AuthenticatedRequest,
    @Query() query: StreamUserFilesQuery,
  ): Observable<MessageEvent> {
    const userId = userIdOf(request)
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }

    return new Observable<MessageEvent>((subscriber) => {
      const close = this.fanout.openStream({
        userId,
        tree: query.tree,
        handler: (change) => {
          subscriber.next({ type: EUserFileEvent.Changed, data: change })
        },
        onClosed: () => subscriber.complete(),
      })
      const heartbeat = setInterval(() => {
        subscriber.next({ type: EUserFileEvent.Heartbeat, data: {} })
      }, HEARTBEAT_INTERVAL_MS)
      return () => {
        clearInterval(heartbeat)
        close()
      }
    })
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
