import { Injectable } from '@nestjs/common'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncService } from './github-app-sync.service'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubHookRetirement } from './github-hook-retirement'
import { GithubHookTeardown } from './github-hook-teardown'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

@Injectable()
export class GithubHookSweepService {
  private readonly retirement: GithubHookRetirement

  constructor(
    private readonly appSync: GithubAppSyncService,
    private readonly lifecycle: GithubHookLifecycleService,
    installations: GithubAppInstallationsService,
    github: GithubService,
    reads: GithubUserReads,
  ) {
    this.retirement = new GithubHookRetirement(installations, new GithubHookTeardown(github, reads))
  }

  async handleSweep(): Promise<void> {
    await this.appSync.syncIfDue()
    await this.retirement.retireCovered()
    await this.lifecycle.handleSweep()
  }
}
