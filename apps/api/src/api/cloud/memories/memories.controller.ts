import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { MemoryEntry, MemoryList, MemorySummary } from '@dltech/atlas-wire'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { EditMemoryDto, MemoryKeyDto, MemoryProjectQuery, PutMemoryDto } from './memories.dto'
import { MemoriesService } from './memories.service'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'memories', version: '1' })
@UseGuards(SessionOrSandboxGuard)
@PodReachable()
@SandboxReachable()
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get('all')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  async handleListAll(@Req() request: AuthenticatedRequest): Promise<MemoryList> {
    const memories = await this.memories.listAll({ userId: userIdOf(request) })
    return { memories }
  }

  @Get()
  @Header('Cache-Control', NO_STORE)
  async handleList(
    @Req() request: AuthenticatedRequest,
    @Query() query: MemoryProjectQuery,
  ): Promise<MemoryList> {
    const memories = await this.memories.list({ userId: userIdOf(request), project: query.project })
    return { memories }
  }

  @Get('entry')
  @Header('Cache-Control', NO_STORE)
  handleGet(@Req() request: AuthenticatedRequest, @Query() query: MemoryKeyDto): Promise<MemoryEntry> {
    return this.memories.get({ ...query, userId: userIdOf(request) })
  }

  @Put('entry')
  handlePut(@Req() request: AuthenticatedRequest, @Body() body: PutMemoryDto): Promise<MemorySummary> {
    return this.memories.put({ ...body, userId: userIdOf(request) })
  }

  @Patch('entry')
  handleEdit(@Req() request: AuthenticatedRequest, @Body() body: EditMemoryDto): Promise<MemorySummary> {
    return this.memories.edit({
      userId: userIdOf(request),
      scope: body.scope,
      project: body.project,
      name: body.name,
      old: body.old,
      replacement: body.new,
      revision: body.revision,
    })
  }

  @Delete('entry')
  @HttpCode(204)
  async handleRemove(@Req() request: AuthenticatedRequest, @Query() query: MemoryKeyDto): Promise<void> {
    await this.memories.remove({ ...query, userId: userIdOf(request) })
  }
}
