import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubApi, type GithubFetch } from './github-api'

export { GithubAppNotInstalled } from './github-api'
export type { GithubFetch } from './github-api'

@Injectable()
export class GithubAppService {
  private readonly api: GithubApi

  constructor(env: EnvService, fetchFn?: GithubFetch) {
    this.api = new GithubApi(env, fetchFn)
  }

  configured(): boolean {
    return this.api.configured()
  }

  /** Minted per call on purpose: the installation token is the run-scoped credential. */
  installationToken(args: { owner: string; repo: string }): Promise<string> {
    return this.api.installationToken(args)
  }
}
