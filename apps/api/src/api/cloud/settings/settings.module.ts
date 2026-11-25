import { Module } from '@nestjs/common'
import { SettingsRouter } from './settings.router'
import { SettingsService } from './settings.service'

@Module({
  providers: [SettingsRouter, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
