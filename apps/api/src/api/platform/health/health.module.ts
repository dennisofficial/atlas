import { Module } from '@nestjs/common'
import { DrainStateService } from './drain-state.service'

@Module({
  providers: [DrainStateService],
  exports: [DrainStateService],
})
export class HealthModule {}
