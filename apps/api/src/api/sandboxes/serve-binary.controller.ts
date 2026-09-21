import { Controller, Get, Res, StreamableFile, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SERVE_BINARY_SHA256_HEADER, ServeBinaryService } from './serve-binary'

/** A wedged serve retries the download itself; the global per-IP throttler must not add to that. */
@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
@SkipThrottle()
export class ServeBinaryController {
  constructor(private readonly serveBinary: ServeBinaryService) {}

  /**
   * The hash header carries the binary's own integrity, separate from the freshness stamp the
   * sandbox already knows from `readStamp()` — a compiled binary's sha256 can never equal a hash
   * of its source, so the sandbox must verify what it downloaded against what was actually served.
   */
  @Get(':threadId/serve-binary')
  async handleDownload(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const hash = await this.serveBinary.binaryHash()
    res.setHeader(SERVE_BINARY_SHA256_HEADER, hash)
    return this.serveBinary.stream()
  }
}
