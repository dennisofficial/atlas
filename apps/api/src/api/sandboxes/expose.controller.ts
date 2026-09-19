import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { ExposeSandboxDto } from './sandboxes.dto'
import { SandboxesService } from './sandboxes.service'
import type { SandboxExposureDto } from './sandboxes.types'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxExposeController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Post(':threadId/expose')
  handleExpose(
    @Param('threadId') threadId: string,
    @Body() body: ExposeSandboxDto,
  ): Promise<SandboxExposureDto> {
    return this.sandboxes.expose({ threadId, port: body.port })
  }
}
