import type { BeforeApplicationShutdown } from '@nestjs/common'
import { DrainStateService } from './platform/health/drain-state.service'

export class HostDrainHook implements BeforeApplicationShutdown {
  constructor(private readonly drain: DrainStateService) {}

  beforeApplicationShutdown(): void {
    this.drain.beginDrain()
  }
}
