import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { db } from '@dltech/atlas-db'
import { GithubAppInstallationsService } from './github-app-installations.service'

/**
 * A poll-backed subscription means no webhook delivers the repo's PR discussion events, so reviews
 * and inline review comments never arrive. The repair is the Atlas GitHub App, installable by any
 * org admin — so the recommendation is shown once per (user, repo) and dismissed thereafter, and is
 * never raised for a repo already covered by the app or a personal hook.
 */
@Injectable()
export class GithubAppInstallNoticeService {
  constructor(
    private readonly installations: GithubAppInstallationsService,
    private readonly env: EnvService,
  ) {}

  installUrl(): string | null {
    const slug = this.env.get('GITHUB_APP_SLUG')
    if (slug === undefined || slug.length === 0) return null
    return `https://github.com/apps/${slug}/installations/new`
  }

  async shouldRecommend(args: { userId: string; repoFullName: string }): Promise<boolean> {
    const dismissed = await db.orm.public.GithubAppNoticeDismissal.where({
      userId: args.userId,
      repoFullName: args.repoFullName,
    }).first()
    if (dismissed !== null) return false

    const hook = await db.orm.public.GithubRepoHook.select('repoFullName').first({
      repoFullName: args.repoFullName,
    })
    if (hook !== null) return false

    return !(await this.installations.coversRepo({ repoFullName: args.repoFullName }))
  }

  async dismiss(args: { userId: string; repoFullName: string }): Promise<void> {
    await db.orm.public.GithubAppNoticeDismissal.upsert({
      create: { userId: args.userId, repoFullName: args.repoFullName },
      update: { dismissedAt: new Date() },
      conflictOn: { userId: args.userId, repoFullName: args.repoFullName },
    })
  }
}
