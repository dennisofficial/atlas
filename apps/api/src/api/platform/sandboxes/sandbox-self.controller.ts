import { sandboxExposePortRequestSchema, sandboxSelfStopRequestSchema } from '@dltech/atlas-wire'
import type { SandboxExposePortReply } from '@dltech/atlas-wire'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { db } from '../../../db'
import type { SandboxAuthenticatedRequest } from './sandbox-token.guard'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { VercelSandboxClient } from './vercel-sandbox.client'

type SandboxIdentity = { threadId: string; name: string }

@Controller({ path: 'sandboxes/self', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxSelfController {
  constructor(private readonly vercel: VercelSandboxClient) {}

  @Post('ports')
  async handleExposePort(
    @Req() request: SandboxAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SandboxExposePortReply> {
    const parsed = sandboxExposePortRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.message)
    const sandbox = await this.identityOf(request)
    const url = await this.vercel.exposePort({ ...sandbox, port: parsed.data.port })
    return { url }
  }

  @Post('stop')
  @HttpCode(204)
  async handleStop(
    @Req() request: SandboxAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = sandboxSelfStopRequestSchema.safeParse(body ?? {})
    if (!parsed.success) throw new BadRequestException(parsed.error.message)
    const sandbox = await this.identityOf(request)
    await this.vercel.stopSession({ ...sandbox, sessionId: parsed.data.sessionId })
  }

  private async identityOf(request: SandboxAuthenticatedRequest): Promise<SandboxIdentity> {
    if (request.sandbox === undefined)
      throw new UnauthorizedException('a sandbox session token is required')
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: request.sandbox.threadId },
      select: { threadId: true, name: true },
    })
    if (row === null) throw new NotFoundException('sandbox not found')
    return row
  }
}
