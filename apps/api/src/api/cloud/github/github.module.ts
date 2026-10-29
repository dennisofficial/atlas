import { Module } from '@nestjs/common'
import { GithubDeviceClient } from './github-device-client'
import { GithubRepoReads } from './github-repo-reads'
import { GithubReposRouter } from './github-repos.router'
import { GithubRouter } from './github.router'
import { GithubService } from './github.service'

@Module({
  providers: [
    GithubRouter,
    GithubReposRouter,
    GithubService,
    GithubRepoReads,
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
  exports: [GithubService, GithubRepoReads],
})
export class GithubModule {}
