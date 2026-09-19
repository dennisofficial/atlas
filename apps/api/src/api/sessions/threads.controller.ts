import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../client-rate-limit'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'
import {
  AdoptThreadDto,
  ChooseLocationDto,
  ChooseModelDto,
  CompactThreadDto,
  CreateThreadDto,
  ForkThreadDto,
  OpenThreadDto,
  RenameThreadDto,
  RewindThreadDto,
  SummariseThreadDto,
} from './sessions.dto'
import { userIdOf } from './session-user'
import type { ThreadDto } from './sessions.types'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'

const projectOf = (project: string | undefined): string => {
  if (project === undefined || project.length === 0) {
    throw new BadRequestException('a project query parameter is required')
  }
  return project
}

const limitOf = (limit: string | undefined): number | undefined => {
  if (limit === undefined) return undefined
  const parsed = Number.parseInt(limit, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new BadRequestException('limit must be a positive integer')
  }
  return parsed
}

@Controller({ path: 'threads', version: '1' })
@UseGuards(SessionOrSandboxGuard)
@Throttle({ default: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttl: 60_000 } })
export class ThreadsController {
  constructor(
    private readonly threads: ThreadsService,
    private readonly history: ThreadsHistoryService,
  ) {}

  @Post()
  handleCreate(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateThreadDto,
  ): Promise<ThreadDto> {
    return this.threads.create({ userId: userIdOf(request), draft: body })
  }

  @Post('open')
  handleOpen(@Req() request: AuthenticatedRequest, @Body() body: OpenThreadDto) {
    return this.threads.open({ userId: userIdOf(request), draft: body })
  }

  @Get('recent')
  handleRecent(
    @Req() request: AuthenticatedRequest,
    @Query('project') project: string | undefined,
  ): Promise<ThreadDto | null> {
    return this.threads.mostRecent({ userId: userIdOf(request), project: projectOf(project) })
  }

  @Get()
  handleList(
    @Req() request: AuthenticatedRequest,
    @Query('project') project: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<ThreadDto[]> {
    return this.threads.list({
      userId: userIdOf(request),
      project: projectOf(project),
      limit: limitOf(limit),
    })
  }

  @Get(':threadId')
  handleFind(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<ThreadDto> {
    return this.threads.find({ userId: userIdOf(request), threadId })
  }

  @Get(':threadId/spawned')
  handleSpawned(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<ThreadDto[]> {
    return this.threads.spawned({ userId: userIdOf(request), threadId })
  }

  @Patch(':threadId/title')
  @HttpCode(204)
  async handleRename(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: RenameThreadDto,
  ): Promise<void> {
    await this.threads.rename({ userId: userIdOf(request), threadId, draft: body })
  }

  @Patch(':threadId/model')
  @HttpCode(204)
  async handleChooseModel(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: ChooseModelDto,
  ): Promise<void> {
    await this.threads.chooseModel({ userId: userIdOf(request), threadId, draft: body })
  }

  @Patch(':threadId/location')
  @HttpCode(204)
  async handleChooseLocation(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: ChooseLocationDto,
  ): Promise<void> {
    await this.threads.chooseLocation({ userId: userIdOf(request), threadId, draft: body })
  }

  @Patch(':threadId/workspace')
  @HttpCode(204)
  async handleAdopt(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: AdoptThreadDto,
  ): Promise<void> {
    await this.threads.adopt({ userId: userIdOf(request), threadId, draft: body })
  }

  @Post(':threadId/rewind')
  @HttpCode(204)
  async handleRewind(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: RewindThreadDto,
  ): Promise<void> {
    await this.history.rewind({ userId: userIdOf(request), threadId, draft: body })
  }

  @Post(':threadId/compact')
  handleCompact(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: CompactThreadDto,
  ): Promise<{ replaced: number }> {
    return this.history.compact({ userId: userIdOf(request), threadId, draft: body })
  }

  @Post(':threadId/summarise')
  handleSummarise(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: SummariseThreadDto,
  ): Promise<{ replaced: number }> {
    return this.history.summarise({ userId: userIdOf(request), threadId, draft: body })
  }

  @Post(':threadId/fork')
  handleFork(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: ForkThreadDto,
  ): Promise<ThreadDto> {
    return this.history.fork({ userId: userIdOf(request), threadId, draft: body })
  }
}
