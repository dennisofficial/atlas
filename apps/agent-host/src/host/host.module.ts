import { Module, type DynamicModule } from '@nestjs/common'

import type { AgentHostEnv } from '../config/env'
import { HostCallsModule } from './calls.module'
import { ControlModule } from './control.module'
import { CoreModule } from './core.module'
import { HolderModule } from './holder.module'
import { HttpModule } from './http.module'
import { RuntimeModule } from './runtime.module'
import { StartupModule } from './startup.module'

@Module({})
export class HostModule {
  static forRoot(env: AgentHostEnv): DynamicModule {
    return {
      module: HostModule,
      imports: [
        CoreModule.forRoot(env),
        ControlModule,
        RuntimeModule,
        HolderModule,
        HostCallsModule,
        HttpModule,
        StartupModule,
      ],
    }
  }
}
