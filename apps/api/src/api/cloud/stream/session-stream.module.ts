import { Module } from '@nestjs/common'
import { HealthModule } from '../../platform/health/health.module'
import { SessionStreamRouter } from './session-stream.router'

@Module({ imports: [HealthModule], providers: [SessionStreamRouter] })
export class SessionStreamModule {}
