import type { Provider } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../../_lib/redis/redis.service'
import { GithubConfig } from '@dltech/atlas-github'
import { GithubDeviceClient } from '@dltech/atlas-github'
import { GithubRepoReads } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'

export function githubConfigOf(env: EnvService): GithubConfig {
  return new GithubConfig({
    appId: env.get('GITHUB_APP_ID'),
    appPrivateKey: env.get('GITHUB_APP_PRIVATE_KEY'),
    appSlug: env.get('GITHUB_APP_SLUG'),
    clientId: env.get('GITHUB_CLIENT_ID'),
    clientSecret: env.get('GITHUB_CLIENT_SECRET'),
    publicApiUrl: env.get('BETTER_AUTH_URL'),
  })
}

export const githubConfigProvider: Provider = {
  provide: GithubConfig,
  inject: [EnvService],
  useFactory: githubConfigOf,
}

export const githubServiceProvider: Provider = {
  provide: GithubService,
  inject: [SecretCipherService, GithubConfig, GithubDeviceClient],
  useFactory: (
    cipher: SecretCipherService,
    config: GithubConfig,
    client: GithubDeviceClient,
  ): GithubService => new GithubService(cipher, config, client),
}

export const githubRepoReadsProvider: Provider = {
  provide: GithubRepoReads,
  useFactory: (): GithubRepoReads => new GithubRepoReads(),
}

export const githubRequestCoordinatorProvider: Provider = {
  provide: GithubRequestCoordinator,
  inject: [RedisService, GithubService],
  useFactory: (redis: RedisService, github: GithubService): GithubRequestCoordinator =>
    new GithubRequestCoordinator(redis, github),
}
