import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { SandboxConfigRouter } from './sandbox-config.router'
import { ScopedConfigService } from './scoped-config.service'

@Module({
  imports: [SessionsModule, WorkspacesModule],
  providers: [ScopedConfigService, SandboxConfigRouter],
  exports: [ScopedConfigService],
})
export class ScopedConfigModule {}
