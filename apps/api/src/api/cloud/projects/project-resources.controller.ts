import type { ProjectSandbox } from '@dltech/atlas-wire/web'
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { UpsertMcpServerDto } from '../mcp-servers/mcp-servers.dto'
import type { McpServerListDto } from '../mcp-servers/mcp-servers.types'
import { SetSecretDto } from '../secrets/secrets.dto'
import type { SecretDetailListDto } from '../secrets/secrets.types'
import type { SettingListDto } from '../settings/settings.types'
import { PatchWorkspaceSettingsDto } from '../workspaces/workspaces.dto'
import { ProjectSandboxDto } from './project-resources.dto'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'projects/:projectId', version: '1' })
@UseGuards(SessionAuthGuard)
export class ProjectResourcesController {
  constructor(
    private readonly resources: ProjectResourcesService,
    private readonly settings: ProjectSettingsService,
  ) {}

  @Get('settings')
  @Header('Cache-Control', NO_STORE)
  async handleListSettings(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<SettingListDto> {
    const settings = await this.settings.list({ userId: userIdOf(request), projectId })
    return { settings }
  }

  @Patch('settings')
  @HttpCode(204)
  async handlePatchSettings(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: PatchWorkspaceSettingsDto,
  ): Promise<void> {
    await this.settings.patch({ userId: userIdOf(request), projectId, values: body.values })
  }

  @Get('sandbox')
  handleReadSandbox(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<ProjectSandbox> {
    return this.resources.readSandbox({ userId: userIdOf(request), projectId })
  }

  @Put('sandbox')
  handleWriteSandbox(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: ProjectSandboxDto,
  ): Promise<ProjectSandbox> {
    return this.resources.writeSandbox({ userId: userIdOf(request), projectId, sandbox: body })
  }

  @Get('secrets')
  @Header('Cache-Control', NO_STORE)
  async handleListSecrets(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<SecretDetailListDto> {
    const secrets = await this.resources.listSecrets({ userId: userIdOf(request), projectId })
    return { secrets }
  }

  @Put('secrets/:name')
  @HttpCode(204)
  async handleSetSecret(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('name') name: string,
    @Body() body: SetSecretDto,
  ): Promise<void> {
    await this.resources.setSecret({
      userId: userIdOf(request),
      projectId,
      name,
      value: body.value,
      kind: body.kind,
    })
  }

  @Delete('secrets/:name')
  @HttpCode(204)
  async handleRemoveSecret(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('name') name: string,
  ): Promise<void> {
    await this.resources.removeSecret({ userId: userIdOf(request), projectId, name })
  }

  @Get('mcp-servers')
  @Header('Cache-Control', NO_STORE)
  async handleListMcpServers(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<McpServerListDto> {
    const servers = await this.resources.listMcpServers({ userId: userIdOf(request), projectId })
    return { servers }
  }

  @Put('mcp-servers/:name')
  @HttpCode(204)
  async handlePutMcpServer(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('name') name: string,
    @Body() body: UpsertMcpServerDto,
  ): Promise<void> {
    await this.resources.putMcpServer({ userId: userIdOf(request), projectId, name, spec: body })
  }

  @Delete('mcp-servers/:name')
  @HttpCode(204)
  async handleRemoveMcpServer(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('name') name: string,
  ): Promise<void> {
    await this.resources.removeMcpServer({ userId: userIdOf(request), projectId, name })
  }
}
