import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppService } from '../../factory/reply/github-app.service'
import { GithubDeviceClient } from './github-device-client'
import { GithubInstallationReads } from './github-installation-reads'
import { GithubController } from './github.controller'
import { GithubService } from './github.service'
import { PullRequestsController } from './pull-requests.controller'
import { PullRequestsService } from './pull-requests.service'

@Module({
  controllers: [GithubController, PullRequestsController],
  providers: [
    GithubService,
    PullRequestsService,
    GithubInstallationReads,
    {
      provide: GithubAppService,
      useFactory: (env: EnvService) => new GithubAppService(env),
      inject: [EnvService],
    },
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
  exports: [GithubService, GithubInstallationReads],
})
export class GithubModule {}
