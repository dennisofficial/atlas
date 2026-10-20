import type { Project } from '@dltech/atlas-wire'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SaveProjectDto } from './projects.dto'
import { ProjectsService } from './projects.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'projects', version: '1' })
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  handleList(@Req() request: AuthenticatedRequest): Promise<Project[]> {
    return this.projects.list({ userId: userIdOf(request) })
  }

  @Post()
  handleCreate(
    @Req() request: AuthenticatedRequest,
    @Body() body: SaveProjectDto,
  ): Promise<Project> {
    return this.projects.create({ userId: userIdOf(request), input: body })
  }

  @Get(':projectId')
  handleRead(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<Project> {
    return this.projects.read({ userId: userIdOf(request), projectId })
  }

  @Put(':projectId')
  handleReplace(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: SaveProjectDto,
  ): Promise<Project> {
    return this.projects.replace({ userId: userIdOf(request), projectId, input: body })
  }

  @Delete(':projectId')
  @HttpCode(204)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<void> {
    await this.projects.remove({ userId: userIdOf(request), projectId })
  }
}
