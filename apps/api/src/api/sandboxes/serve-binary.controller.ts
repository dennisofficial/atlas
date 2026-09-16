import { Controller, Get, StreamableFile, UseGuards } from '@nestjs/common'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { ServeBinaryService } from './serve-binary'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
export class ServeBinaryController {
  constructor(private readonly serveBinary: ServeBinaryService) {}

  @Get(':threadId/serve-binary')
  async handleDownload(): Promise<StreamableFile> {
    return this.serveBinary.stream()
  }
}
