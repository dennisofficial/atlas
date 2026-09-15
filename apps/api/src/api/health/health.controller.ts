import { Controller, Get } from '@nestjs/common'
import { Public } from '../../_core/decorators/public.decorator'

@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  @Public()
  handleHealth() {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }
  }
}
