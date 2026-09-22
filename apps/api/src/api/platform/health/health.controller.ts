import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common'
import { Public } from '../../../_core/decorators/public.decorator'
import { EMigrationState, MigrationStateService } from './migration-state.service'

export type HealthReport = {
  status: string
  service: string
  timestamp: string
  uptime: number
  migrations: EMigrationState
}

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly migrations: MigrationStateService) {}

  @Get()
  @Public()
  @HttpCode(200)
  async handleHealth(): Promise<HealthReport> {
    const report = await this.migrations.report()

    if (report.state === EMigrationState.Behind) {
      throw new ServiceUnavailableException(
        `the database is missing ${report.pending.length} migration(s) this build expects: ${report.pending.join(', ')}`,
      )
    }

    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      migrations: report.state,
    }
  }
}
