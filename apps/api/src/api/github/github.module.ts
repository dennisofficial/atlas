import { Module } from '@nestjs/common'
import { GithubDeviceClient } from './github-device-client'
import { GithubController } from './github.controller'
import { GithubService } from './github.service'

@Module({
  controllers: [GithubController],
  providers: [
    GithubService,
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
})
export class GithubModule {}
