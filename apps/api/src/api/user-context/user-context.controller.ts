import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Put,
  Req,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import {
  bufferBodyOf,
  isGzipContentType,
  wantsGzipResponse,
} from '../context-archive/context-archive-http'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { UserContextService } from './user-context.service'
import type { MemoryBundleDto } from './user-context.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

function legacyBundleOf(body: unknown): string {
  const bundle = (body as { bundle?: unknown } | null)?.bundle
  if (typeof bundle !== 'string') throw new BadRequestException('expected a bundle string')
  return bundle
}

@Controller({ path: 'user-context', version: '1' })
@UseGuards(SessionOrSandboxGuard)
export class UserContextController {
  constructor(private readonly userContext: UserContextService) {}

  @Get('memory')
  async handleGet(
    @Req() request: AuthenticatedRequest,
    @Headers('accept') accept: string | undefined,
  ): Promise<MemoryBundleDto | StreamableFile> {
    const userId = userIdOf(request)
    if (wantsGzipResponse(accept)) {
      const archive = await this.userContext.getMemoryArchive({ userId })
      if (archive === null) throw new NotFoundException('no memory archive stored yet')
      return new StreamableFile(archive, { type: 'application/gzip' })
    }
    return { bundle: await this.userContext.getMemory({ userId }) }
  }

  @Put('memory')
  @HttpCode(204)
  async handlePut(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<void> {
    const userId = userIdOf(request)
    if (isGzipContentType(contentType)) {
      await this.userContext.putMemoryArchive({ userId, archive: bufferBodyOf(body) })
      return
    }
    await this.userContext.putMemory({ userId, bundle: legacyBundleOf(body) })
  }
}
