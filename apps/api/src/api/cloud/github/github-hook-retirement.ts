import { Logger } from '@nestjs/common'
import { db, or } from '@dltech/atlas-db'
import type { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubHookTeardown } from './github-hook-teardown'
import { ERepoHookStatus } from './github-realtime.types'

const SWEEP_LEASE_MS = 5 * 60 * 1_000

export class GithubHookRetirement {
  private readonly logger = new Logger(GithubHookRetirement.name)

  constructor(
    private readonly installations: GithubAppInstallationsService,
    private readonly teardown: GithubHookTeardown,
  ) {}

  async retireCovered(): Promise<void> {
    const active = await db.orm.public.GithubRepoHook.where({
      status: ERepoHookStatus.Active,
    }).all()
    for (const hook of active) {
      if (
        !(await this.installations.coversRepo({
          repoFullName: hook.repoFullName,
        }))
      )
        continue
      const now = new Date()
      const claimed = await db.orm.public.GithubRepoHook.where({
        repoFullName: hook.repoFullName,
        status: ERepoHookStatus.Active,
      })
        .where((row) => or(row.sweepLeaseUntil.isNull(), row.sweepLeaseUntil.lt(now)))
        .updateAndCount({
          sweepLeaseUntil: new Date(now.getTime() + SWEEP_LEASE_MS),
          status: ERepoHookStatus.Deleting,
        })
      if (claimed !== 1) continue
      try {
        const outcome = await this.teardown.run({
          repoFullName: hook.repoFullName,
        })
        this.logger.log(
          `retire app-covered hook repo=${hook.repoFullName} hookId=${hook.hookId} outcome=${outcome}`,
        )
      } catch (failure) {
        await db.orm.public.GithubRepoHook.where({
          repoFullName: hook.repoFullName,
        }).updateAndCount({
          status: ERepoHookStatus.Active,
          sweepLeaseUntil: null,
        })
        this.logger.warn(`app-covered hook retirement paused: ${String(failure)}`)
        return
      }
    }
  }
}
