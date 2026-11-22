import { Logger, Module } from '@nestjs/common'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { GithubDeviceClient } from './github-device-client'
import { GithubRepoReads } from './github-repo-reads'
import { GithubReposRouter } from './github-repos.router'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { GithubRouter } from './github.router'
import { GithubService } from './github.service'
import { setGithubLogSink } from './github-log'

setGithubLogSink((context) => new Logger(context))

@Module({
  imports: [RedisModule],
  providers: [
    GithubRouter,
    GithubReposRouter,
    GithubService,
    GithubRepoReads,
    GithubRequestCoordinator,
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
  exports: [GithubService, GithubRepoReads, GithubRequestCoordinator],
})
export class GithubModule {}
