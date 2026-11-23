import { db } from '@dltech/atlas-db'
import { EGithubCallSource } from './github-call-log'
import { repoPattern } from './github-pr-identity'
import { ERepoHookStatus } from './github-realtime.types'
import type { GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

export enum EHookTeardownOutcome {
  Deleted = 'deleted',
  Orphaned = 'orphaned',
  Missing = 'missing',
}

export class GithubHookTeardown {
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
  ) {}

  async run(args: { repoFullName: string }): Promise<EHookTeardownOutcome> {
    const hook = await db.orm.public.GithubRepoHook.where((hook) =>
      hook.repoFullName.ilike(repoPattern(args.repoFullName)),
    ).first()
    if (hook === null) return EHookTeardownOutcome.Missing

    const token = await this.github.findToken({ userId: hook.createdBy })
    if (token === undefined) return this.orphan(args)

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    const outcome = await this.reads.deleteHook({
      source: EGithubCallSource.HookSweep,
      token,
      owner,
      repo,
      hookId: Number(hook.hookId),
    })
    if (outcome === 'unauthorized') return this.orphan(args)

    await db.orm.public.GithubRepoHook.where({
      repoFullName: args.repoFullName,
    }).deleteAndCount()
    return EHookTeardownOutcome.Deleted
  }

  private async orphan(args: { repoFullName: string }): Promise<EHookTeardownOutcome> {
    await db.orm.public.GithubRepoHook.where({
      repoFullName: args.repoFullName,
    }).update({
      status: ERepoHookStatus.Orphaned,
      sweepLeaseUntil: null,
    })
    return EHookTeardownOutcome.Orphaned
  }
}
