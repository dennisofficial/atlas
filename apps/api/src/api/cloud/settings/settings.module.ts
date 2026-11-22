import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SettingsRouter } from './settings.router'
import { SettingsService } from './settings.service'

@Module({
  imports: [SessionsModule],
  providers: [SettingsRouter, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
