import { Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'
import type {
  GithubAppInstallationRepositoriesWebhookPayload,
  GithubAppInstallationWebhookPayload,
} from './github-webhook.types'

/**
 * The record of where the Atlas GitHub App is installed. An installation covering a repo means the
 * app's own webhook delivers that repo's PR events, so the repo is realtime without a personal
 * hook — this is what restores review/comment events on org repos the subscribing user cannot admin.
 * A suspended installation covers nothing until it is unsuspended.
 */
@Injectable()
export class GithubAppInstallationsService {
  async coversRepo(args: { repoFullName: string }): Promise<boolean> {
    const match = await db.orm.public.GithubAppInstallation.select('installationId')
      .where({ suspendedAt: null })
      .where((installation, { fns }) =>
        fns.raw`EXISTS (SELECT 1 FROM unnest(${installation.repos}) AS held(repo) WHERE lower(held.repo) = ${normalizedRepo(args.repoFullName)})`.returns(
          'pg/bool@1',
        ),
      )
      .first()
    return match !== null
  }

  async read(args: { installationId: bigint }): Promise<{ accountLogin: string } | null> {
    return db.orm.public.GithubAppInstallation.select('accountLogin').first({
      installationId: args.installationId,
    })
  }

  async applyInstallation(payload: GithubAppInstallationWebhookPayload): Promise<void> {
    const { installation } = payload
    const installationId = BigInt(installation.id)
    if (payload.action === 'deleted') {
      await db.orm.public.GithubAppInstallation.where({ installationId }).deleteAndCount()
      return
    }
    if (payload.repositories === undefined) return

    await db.orm.public.GithubAppInstallation.upsert({
      conflictOn: { installationId },
      create: {
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos: payload.repositories.map((repo) => normalizedRepo(repo.full_name)),
        suspendedAt:
          installation.suspended_at === null ? null : new Date(installation.suspended_at),
      },
      update: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos: payload.repositories.map((repo) => normalizedRepo(repo.full_name)),
        suspendedAt:
          installation.suspended_at === null ? null : new Date(installation.suspended_at),
      },
    })
  }

  async applyRepositories(payload: GithubAppInstallationRepositoriesWebhookPayload): Promise<void> {
    const held = await db.orm.public.GithubAppInstallation.first({
      installationId: BigInt(payload.installation.id),
    })
    if (held === null) return

    const removed = new Set(
      (payload.repositories_removed ?? []).map((repo) => normalizedRepo(repo.full_name)),
    )
    const kept = (held.repos ?? []).filter(
      (fullName): fullName is string => fullName !== null && !removed.has(normalizedRepo(fullName)),
    )
    const added = (payload.repositories_added ?? []).map((repo) => normalizedRepo(repo.full_name))

    await db.orm.public.GithubAppInstallation.where({
      installationId: BigInt(payload.installation.id),
    }).update({ repos: [...new Set([...kept.map(normalizedRepo), ...added])] })
  }
}
