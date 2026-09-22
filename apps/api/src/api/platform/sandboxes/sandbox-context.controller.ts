import { Controller, Get, NotFoundException, Req, StreamableFile, UseGuards } from '@nestjs/common'
import type { SandboxAuthenticatedRequest } from './sandbox-token.guard'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'

function sandboxThreadIdOf(request: SandboxAuthenticatedRequest): string {
  const sandbox = request.sandbox
  if (sandbox === undefined) throw new NotFoundException('sandbox not found')
  return sandbox.threadId
}

/**
 * `context` has no `:threadId` segment, so it must be registered ahead of
 * `SandboxesController`'s `GET :threadId` in `SandboxesModule` — Express matches routes in
 * registration order, and `:threadId` would otherwise swallow the literal `context` path.
 */
@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxContextController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Get('context')
  async handleGetContext(@Req() request: SandboxAuthenticatedRequest): Promise<StreamableFile> {
    const threadId = sandboxThreadIdOf(request)
    const archive = await this.sandboxes.getContextArchive({ threadId })
    if (archive === null) throw new NotFoundException('no context archive stored yet')
    return new StreamableFile(archive, { type: 'application/gzip' })
  }
}
