import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
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
    const match = await db.githubAppInstallation.findFirst({
      where: { repos: { has: args.repoFullName }, suspendedAt: null },
      select: { installationId: true },
    })
    return match !== null
  }

  async read(args: { installationId: bigint }): Promise<{ accountLogin: string } | null> {
    return db.githubAppInstallation.findUnique({
      where: { installationId: args.installationId },
      select: { accountLogin: true },
    })
  }

  async applyInstallation(payload: GithubAppInstallationWebhookPayload): Promise<void> {
    const { installation } = payload
    const installationId = BigInt(installation.id)
    if (payload.action === 'deleted') {
      await db.githubAppInstallation.deleteMany({ where: { installationId } })
      return
    }
    if (payload.repositories === undefined) return

    await db.githubAppInstallation.upsert({
      where: { installationId },
      create: {
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos: payload.repositories.map((repo) => repo.full_name),
        suspendedAt:
          installation.suspended_at === null ? null : new Date(installation.suspended_at),
      },
      update: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos: payload.repositories.map((repo) => repo.full_name),
        suspendedAt:
          installation.suspended_at === null ? null : new Date(installation.suspended_at),
      },
    })
  }

  async applyRepositories(payload: GithubAppInstallationRepositoriesWebhookPayload): Promise<void> {
    const held = await db.githubAppInstallation.findUnique({
      where: { installationId: BigInt(payload.installation.id) },
    })
    if (held === null) return

    const removed = new Set((payload.repositories_removed ?? []).map((repo) => repo.full_name))
    const kept = held.repos.filter((fullName) => !removed.has(fullName))
    const added = (payload.repositories_added ?? []).map((repo) => repo.full_name)

    await db.githubAppInstallation.update({
      where: { installationId: BigInt(payload.installation.id) },
      data: { repos: [...new Set([...kept, ...added])] },
    })
  }
}
