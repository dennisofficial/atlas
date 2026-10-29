import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SandboxConfigRouter } from './sandbox-config.router'
import { ScopedConfigService } from './scoped-config.service'

@Module({
  imports: [SessionsModule],
  providers: [ScopedConfigService, SandboxConfigRouter],
  exports: [ScopedConfigService],
})
export class ScopedConfigModule {}
