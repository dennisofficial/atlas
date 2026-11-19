import { Module, type DynamicModule } from '@nestjs/common'

import type { AgentHostEnv } from './config/env'
import { HostCallsModule } from './host/calls.module'
import { ControlModule } from './host/control.module'
import { CoreModule } from './host/core.module'
import { HolderModule } from './host/holder.module'
import { HttpModule } from './host/http.module'
import { RuntimeModule } from './host/runtime.module'
import { StartupModule } from './host/startup.module'
import { MacLinkModule } from './mac-link/mac-link.module'

@Module({})
export class AgentModule {
  static forRoot(env: AgentHostEnv): DynamicModule {
    return {
      module: AgentModule,
      imports: [
        CoreModule.forRoot(env),
        ControlModule,
        RuntimeModule,
        HolderModule,
        HostCallsModule,
        HttpModule,
        StartupModule,
        MacLinkModule,
      ],
    }
  }
}
