import { Module } from '@nestjs/common'
import { DesktopAuthRouter } from './desktop-auth.router'
import { DesktopAuthService } from './desktop-auth.service'

@Module({ providers: [DesktopAuthService, DesktopAuthRouter] })
export class DesktopAuthModule {}
