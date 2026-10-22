import { Global, Module } from '@nestjs/common'
import { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { PodLaunchService } from './pod-launch.service'
import { ThreadLaunchService } from './thread-launch.service'

@Global()
@Module({
  imports: [ScopedConfigModule, SessionsModule],
  providers: [
    PodLaunchService,
    ThreadLaunchService,
    { provide: ThreadLauncher, useExisting: ThreadLaunchService },
  ],
  exports: [ThreadLauncher, PodLaunchService],
})
export class ThreadLauncherModule {}
