import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import { UpsertMcpServerDto } from './mcp-servers.dto'
import { McpServersService } from './mcp-servers.service'
import type { McpServerListDto } from './mcp-servers.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'mcp-servers', version: '1' })
@UseGuards(SessionAuthGuard)
export class McpServersController {
  constructor(private readonly servers: McpServersService) {}

  @Get()
  async handleList(@Req() request: AuthenticatedRequest): Promise<McpServerListDto> {
    return { servers: await this.servers.list({ userId: userIdOf(request) }) }
  }

  @Put(':name')
  @HttpCode(204)
  async handlePut(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
    @Body() body: UpsertMcpServerDto,
  ): Promise<void> {
    await this.servers.put({ userId: userIdOf(request), name, spec: body })
  }

  @Delete(':name')
  @HttpCode(204)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
  ): Promise<void> {
    await this.servers.remove({ userId: userIdOf(request), name })
  }
}
