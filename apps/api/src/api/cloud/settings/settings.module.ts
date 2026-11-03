import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { UserVercelModule } from '../user-vercel/user-vercel.module'
import { SettingsRouter } from './settings.router'
import { SettingsService } from './settings.service'

@Module({
  imports: [SessionsModule, UserVercelModule],
  providers: [SettingsRouter, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
