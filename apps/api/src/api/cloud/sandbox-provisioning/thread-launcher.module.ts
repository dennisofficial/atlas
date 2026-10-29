import { Global, Module } from '@nestjs/common'
import { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import { backgroundWorkProvider } from '../../../_lib/background-work/background-work.providers'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { ThreadTitlingModule } from '../thread-titling/thread-titling.module'
import { PodLaunchService } from './pod-launch.service'
import { ThreadLaunchService } from './thread-launch.service'

@Global()
@Module({
  imports: [ScopedConfigModule, SessionsModule, ThreadTitlingModule],
  providers: [
    backgroundWorkProvider(),
    PodLaunchService,
    ThreadLaunchService,
    { provide: ThreadLauncher, useExisting: ThreadLaunchService },
  ],
  exports: [ThreadLauncher, PodLaunchService],
})
export class ThreadLauncherModule {}
