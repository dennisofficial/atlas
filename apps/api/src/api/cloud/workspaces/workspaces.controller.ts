import type { WorkspaceSecret, WorkspaceVercelCredential } from '@dltech/atlas-wire/web'
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
import type { SettingListDto } from '../settings/settings.types'
import { PatchWorkspaceSettingsDto } from './workspaces.dto'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'workspaces/:organizationId', version: '1' })
@UseGuards(SessionAuthGuard)
export class WorkspacesController {
  constructor(
    private readonly resources: WorkspaceResourcesService,
    private readonly settings: WorkspaceSettingsService,
    private readonly vercel: WorkspaceVercelService,
  ) {}

  @Get('secrets')
  @Header('Cache-Control', NO_STORE)
  async handleListSecrets(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<{ secrets: WorkspaceSecret[] }> {
    const secrets = await this.resources.listSecrets({ userId: userIdOf(request), organizationId })
    return { secrets }
  }

  @Put('secrets/:name')
  @HttpCode(204)
  async handleSetSecret(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('name') name: string,
    @Body() body: SetSecretDto,
  ): Promise<void> {
    await this.resources.setSecret({
      userId: userIdOf(request),
      organizationId,
      name,
      value: body.value,
      kind: body.kind,
    })
  }

  @Delete('secrets/:name')
  @HttpCode(204)
  async handleRemoveSecret(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('name') name: string,
  ): Promise<void> {
    await this.resources.removeSecret({ userId: userIdOf(request), organizationId, name })
  }

  @Get('mcp-servers')
  @Header('Cache-Control', NO_STORE)
  async handleListMcpServers(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<McpServerListDto> {
    const servers = await this.resources.listMcpServers({
      userId: userIdOf(request),
      organizationId,
    })
    return { servers }
  }

  @Put('mcp-servers/:name')
  @HttpCode(204)
  async handlePutMcpServer(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('name') name: string,
    @Body() body: UpsertMcpServerDto,
  ): Promise<void> {
    await this.resources.putMcpServer({
      userId: userIdOf(request),
      organizationId,
      name,
      spec: body,
    })
  }

  @Delete('mcp-servers/:name')
  @HttpCode(204)
  async handleRemoveMcpServer(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('name') name: string,
  ): Promise<void> {
    await this.resources.removeMcpServer({ userId: userIdOf(request), organizationId, name })
  }

  @Get('settings')
  @Header('Cache-Control', NO_STORE)
  async handleListSettings(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<SettingListDto> {
    const settings = await this.settings.list({ userId: userIdOf(request), organizationId })
    return { settings }
  }

  @Patch('settings')
  @HttpCode(204)
  async handlePatchSettings(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: PatchWorkspaceSettingsDto,
  ): Promise<void> {
    await this.settings.patch({ userId: userIdOf(request), organizationId, values: body.values })
  }

  @Get('vercel')
  @Header('Cache-Control', NO_STORE)
  handleReadVercel(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<WorkspaceVercelCredential> {
    return this.vercel.read({ userId: userIdOf(request), organizationId })
  }

  @Put('vercel')
  @HttpCode(204)
  async handleWriteVercel(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.vercel.write({ userId: userIdOf(request), organizationId, body })
  }

  @Delete('vercel')
  @HttpCode(204)
  async handleRemoveVercel(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<void> {
    await this.vercel.remove({ userId: userIdOf(request), organizationId })
  }
}
