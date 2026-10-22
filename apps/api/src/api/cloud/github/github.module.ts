import { Module } from '@nestjs/common'
import { GithubDeviceClient } from './github-device-client'
import { GithubRepoReads } from './github-repo-reads'
import { GithubReposController } from './github-repos.controller'
import { GithubController } from './github.controller'
import { GithubService } from './github.service'

@Module({
  controllers: [GithubController, GithubReposController],
  providers: [
    GithubService,
    GithubRepoReads,
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
  exports: [GithubService],
})
export class GithubModule {}
