import type { DynamicModule, Type } from '@nestjs/common'
import { DrainStateService } from './platform/health/drain-state.service'
import { HealthModule } from './platform/health/health.module'
import { HostDrainHook } from './host-drain-hook'

export const hostRootModule = (args: {
  appModule: Type
  hostModule: DynamicModule
}): DynamicModule => ({
  module: class HostRootModule {},
  imports: [args.appModule, HealthModule, args.hostModule],
  providers: [
    {
      provide: HostDrainHook,
      useFactory: (drain: DrainStateService) => new HostDrainHook(drain),
      inject: [DrainStateService],
    },
  ],
})
