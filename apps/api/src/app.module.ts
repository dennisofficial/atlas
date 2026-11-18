import type { DynamicModule } from '@nestjs/common'
import { AgentModule } from './agent'
import type { AgentHostEnv } from './agent'
import { ApiModule } from './api/api.module'
import { HostDrainHook } from './api/host-drain-hook'
import { DrainStateService } from './api/platform/health/drain-state.service'
import { HealthModule } from './api/platform/health/health.module'

export class AppModule {
  static forRoot(env: AgentHostEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiModule, HealthModule, AgentModule.forRoot(env)],
      providers: [
        {
          provide: HostDrainHook,
          useFactory: (drain: DrainStateService) => new HostDrainHook(drain),
          inject: [DrainStateService],
        },
      ],
    }
  }
}
