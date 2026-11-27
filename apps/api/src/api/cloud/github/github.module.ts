import { Logger, Module } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { BrowserReturnService } from '../../../agent'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubRedirectService } from './github-redirect.service'
import { GithubOauthController } from './github-oauth.controller'
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
  controllers: [GithubOauthController],
  providers: [
    GithubRouter,
    GithubRedirectService,
    {
      provide: BrowserReturnService,
      inject: [EnvService, SecretCipherService],
      useFactory: (env: EnvService, cipher: SecretCipherService) =>
        new BrowserReturnService({
          db,
          cipher,
          publicUrl: env.get('BETTER_AUTH_URL'),
          webOrigin: env.get('WEB_ORIGIN'),
        }),
    },
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
