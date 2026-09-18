import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'
import { EventsService } from './events.service'
import { AppendEventsDto } from './sessions.dto'
import { userIdOf } from './session-user'
import type { EventDto } from './sessions.types'

const upToOf = (upTo: string | undefined): number | undefined => {
  if (upTo === undefined) return undefined
  const parsed = Number.parseInt(upTo, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new BadRequestException('upTo must be a non-negative integer')
  }
  return parsed
}

@Controller({ path: 'threads/:threadId/events', version: '1' })
@UseGuards(SessionOrSandboxGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  handleAppend(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: AppendEventsDto,
  ): Promise<EventDto[]> {
    return this.events.append({ userId: userIdOf(request), threadId, draft: body })
  }

  @Get()
  handleRead(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Query('upTo') upTo: string | undefined,
    @Query('own') own: string | undefined,
  ): Promise<EventDto[]> {
    const args = {
      userId: userIdOf(request),
      threadId,
      upTo: upToOf(upTo),
    }
    if (own === 'true') return this.events.readOwn(args)
    return this.events.read(args)
  }

  @Get('head')
  async handleHead(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<{ head: number }> {
    return this.events.head({ userId: userIdOf(request), threadId })
  }
}
