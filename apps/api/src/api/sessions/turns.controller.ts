import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'
import { RecordTurnDto } from './sessions.dto'
import { userIdOf } from './session-user'
import type { TurnDto, TurnTreeDto } from './sessions.types'
import { TurnsService } from './turns.service'

@Controller({ path: 'threads/:threadId/turns', version: '1' })
@UseGuards(SessionOrSandboxGuard)
export class TurnsController {
  constructor(private readonly turns: TurnsService) {}

  @Put(':runId')
  @HttpCode(204)
  async handleRecord(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Param('runId') runId: string,
    @Body() body: RecordTurnDto,
  ): Promise<void> {
    await this.turns.record({ userId: userIdOf(request), threadId, runId, draft: body })
  }

  @Get('tree')
  handleTree(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<TurnTreeDto> {
    return this.turns.forThreadTree({ userId: userIdOf(request), threadId })
  }

  @Get()
  handleList(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<TurnDto[]> {
    return this.turns.forThread({ userId: userIdOf(request), threadId })
  }
}
