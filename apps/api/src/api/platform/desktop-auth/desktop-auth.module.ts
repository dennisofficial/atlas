import { Module } from '@nestjs/common'
import { GoogleAccountRouter } from './google-account.router'
import { GoogleLinkController } from './google-link.controller'
import { GoogleLinkService } from './google-link.service'
import { DesktopAuthRouter } from './desktop-auth.router'
import { DesktopAuthService } from './desktop-auth.service'

@Module({
  controllers: [GoogleLinkController],
  providers: [DesktopAuthService, DesktopAuthRouter, GoogleLinkService, GoogleAccountRouter],
})
export class DesktopAuthModule {}
