import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionOrSandboxGuard } from './session-or-sandbox.guard'
import { EventsService } from './events.service'
import { AppendEventsDto, ReplaceEventsDto } from './sessions.dto'
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
@Throttle({ default: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttl: 60_000 } })
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

  @Put()
  handleReplace(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: ReplaceEventsDto,
  ): Promise<EventDto[]> {
    return this.events.replace({ userId: userIdOf(request), threadId, draft: body })
  }

  /** Serve re-reads this several times per turn iteration; a global throttle here would kill a running turn. */
  @Get()
  @SkipThrottle()
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
