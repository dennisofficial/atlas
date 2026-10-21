import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ScopedConfigController } from './scoped-config.controller'
import { ScopedConfigService } from './scoped-config.service'

@Module({
  imports: [SessionsModule, WorkspacesModule],
  controllers: [ScopedConfigController],
  providers: [ScopedConfigService],
  exports: [ScopedConfigService],
})
export class ScopedConfigModule {}
