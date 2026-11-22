import { Logger, Module } from '@nestjs/common'
import { RedisModule } from '../../../_lib/redis/redis.module'
import { GithubConfig } from '@dltech/atlas-github'
import { GithubDeviceClient } from '@dltech/atlas-github'
import { GithubRepoReads } from '@dltech/atlas-github'
import { GithubReposRouter } from './github-repos.router'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubRouter } from './github.router'
import { GithubService } from '@dltech/atlas-github'
import { setGithubLogSink } from '@dltech/atlas-github'
import {
  githubConfigProvider,
  githubRepoReadsProvider,
  githubRequestCoordinatorProvider,
  githubServiceProvider,
} from './github.providers'

setGithubLogSink((context) => new Logger(context))

@Module({
  imports: [RedisModule],
  providers: [
    GithubRouter,
    GithubReposRouter,
    githubConfigProvider,
    githubServiceProvider,
    githubRepoReadsProvider,
    githubRequestCoordinatorProvider,
    { provide: GithubDeviceClient, useFactory: () => new GithubDeviceClient({}) },
  ],
  exports: [GithubService, GithubRepoReads, GithubRequestCoordinator, GithubConfig],
})
export class GithubModule {}
