import { Injectable } from '@nestjs/common'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncGate } from './github-app-sync-gate'
import { GithubAppSyncService } from './github-app-sync.service'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubHookRetirement } from './github-hook-retirement'
import { GithubHookTeardown } from './github-hook-teardown'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

export const HOOK_LIVENESS_KEY = 'hook-liveness'
export const HOOK_LIVENESS_INTERVAL_MS = 60 * 60_000
export const HOOK_LIVENESS_PER_PASS = 5

@Injectable()
export class GithubHookSweepService {
  private readonly retirement: GithubHookRetirement

  constructor(
    private readonly appSync: GithubAppSyncService,
    private readonly lifecycle: GithubHookLifecycleService,
    installations: GithubAppInstallationsService,
    github: GithubService,
    reads: GithubUserReads,
    private readonly gate: GithubAppSyncGate,
  ) {
    this.retirement = new GithubHookRetirement(installations, new GithubHookTeardown(github, reads))
  }

  async handleSweep(): Promise<void> {
    await this.appSync.syncIfDue()
    await this.retirement.retireCovered()
    await this.lifecycle.handleSweep()
    if (await this.livenessDue())
      await this.lifecycle.verifyHeldHooks({ limit: HOOK_LIVENESS_PER_PASS })
  }

  private async livenessDue(): Promise<boolean> {
    try {
      return await this.gate.claim({
        key: HOOK_LIVENESS_KEY,
        ttlMs: HOOK_LIVENESS_INTERVAL_MS,
      })
    } catch {
      return false
    }
  }
}
