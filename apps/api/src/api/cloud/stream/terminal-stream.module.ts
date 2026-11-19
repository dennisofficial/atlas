import { Module } from '@nestjs/common'
import { ControlPlaneModule } from '../../platform/control/control-plane.module'
import { HealthModule } from '../../platform/health/health.module'
import { TerminalStreamRouter } from './terminal-stream.router'
import { TerminalStreamService } from './terminal-stream.service'

@Module({
  imports: [HealthModule, ControlPlaneModule],
  providers: [TerminalStreamRouter, TerminalStreamService],
})
export class TerminalStreamModule {}
