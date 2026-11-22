import { db } from '@dltech/atlas-db'
import { markReposTargetsDue } from './github-due-scheduler'
import { normalizedRepo } from './github-pr-identity'
import type {
  GithubAppInstallationRepositoriesWebhookPayload,
  GithubAppInstallationWebhookPayload,
} from './github-webhook.types'

export type RepoCoverage = ReadonlySet<string>

const KNOWN_INSTALLATION_TTL_MS = 60 * 1_000

export const reposWithChangedCoverage = (args: {
  before: RepoCoverage
  after: RepoCoverage
}): string[] =>
  [...new Set([...args.before, ...args.after])].filter(
    (repo) => args.before.has(repo) !== args.after.has(repo),
  )

type CoverageFields = {
  repos: readonly (string | null)[] | null
  suspendedAt: Date | null
}

const coverageOf = (row: CoverageFields): RepoCoverage =>
  new Set(
    row.suspendedAt === null
      ? (row.repos ?? [])
          .filter((repo): repo is string => repo !== null)
          .map((repo) => normalizedRepo(repo))
      : [],
  )

/**
 * The record of where the Atlas GitHub App is installed. An installation covering a repo means the
 * app's own webhook delivers that repo's PR events, so the repo is realtime without a personal
 * hook — this is what restores review/comment events on org repos the subscribing user cannot admin.
 * A suspended installation covers nothing until it is unsuspended.
 */
export class GithubAppInstallationsService {
  private readonly known = new Map<string, number>()

  async installationForRepo(args: { repoFullName: string }): Promise<bigint | null> {
    const match = await db.orm.public.GithubAppInstallation.select('installationId')
      .where({ suspendedAt: null })
      .where((installation, { fns }) =>
        fns.raw`EXISTS (SELECT 1 FROM unnest(${installation.repos}) AS held(repo) WHERE lower(held.repo) = ${normalizedRepo(args.repoFullName)})`.returns(
          'pg/bool@1',
        ),
      )
      .first()
    return match?.installationId ?? null
  }

  async coversRepo(args: { repoFullName: string }): Promise<boolean> {
    return (await this.installationForRepo(args)) !== null
  }

  async read(args: { installationId: bigint }): Promise<{ accountLogin: string } | null> {
    return db.orm.public.GithubAppInstallation.select('accountLogin').first({
      installationId: args.installationId,
    })
  }

  async isKnown(args: { installationId: bigint }): Promise<boolean> {
    const key = String(args.installationId)
    const until = this.known.get(key)
    if (until !== undefined && until > Date.now()) return true
    const held = await this.read({ installationId: args.installationId })
    if (held === null) {
      this.known.delete(key)
      return false
    }
    this.remember({ installationId: args.installationId })
    return true
  }

  forget(args: { installationId: bigint }): void {
    this.known.delete(String(args.installationId))
  }

  async coveredRepos(): Promise<RepoCoverage> {
    const rows = await db.orm.public.GithubAppInstallation.select('repos', 'suspendedAt')
      .where({ suspendedAt: null })
      .all()
    return new Set(rows.flatMap((row) => [...coverageOf(row)]))
  }

  async heldRepos(args: { installationId: bigint }): Promise<string[]> {
    const held = await db.orm.public.GithubAppInstallation.first({
      installationId: args.installationId,
    })
    return (held?.repos ?? []).filter((repo): repo is string => repo !== null)
  }

  async upsert(args: {
    installationId: bigint
    accountLogin: string
    accountType: string
    repos: string[]
    suspendedAt: Date | null
  }): Promise<void> {
    const { installationId, ...fields } = args
    await db.orm.public.GithubAppInstallation.upsert({
      conflictOn: { installationId },
      create: { installationId, ...fields },
      update: fields,
    })
    this.remember({ installationId })
  }

  async retainOnly(args: { installationIds: bigint[] }): Promise<void> {
    const keep = new Set(args.installationIds)
    const rows = await db.orm.public.GithubAppInstallation.select('installationId').all()
    for (const { installationId } of rows) {
      if (keep.has(installationId)) continue
      await db.orm.public.GithubAppInstallation.where({ installationId }).deleteAndCount()
      this.forget({ installationId })
    }
  }

  async applyInstallation(payload: GithubAppInstallationWebhookPayload): Promise<void> {
    const { installation } = payload
    const installationId = BigInt(installation.id)
    const before = await this.coverageOf({ installationId })
    if (payload.action === 'deleted') {
      await db.orm.public.GithubAppInstallation.where({ installationId }).deleteAndCount()
      this.forget({ installationId })
      await this.markChangedDue({ before, after: new Set() })
      return
    }
    if (payload.repositories === undefined) return

    const repos = payload.repositories.map((repo) => normalizedRepo(repo.full_name))
    const suspendedAt =
      installation.suspended_at === null ? null : new Date(installation.suspended_at)
    await db.orm.public.GithubAppInstallation.upsert({
      conflictOn: { installationId },
      create: {
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos,
        suspendedAt,
      },
      update: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repos,
        suspendedAt,
      },
    })
    this.remember({ installationId })
    await this.markChangedDue({
      before,
      after: coverageOf({ repos, suspendedAt }),
    })
  }

  async applyRepositories(payload: GithubAppInstallationRepositoriesWebhookPayload): Promise<void> {
    const installationId = BigInt(payload.installation.id)
    const held = await db.orm.public.GithubAppInstallation.first({ installationId })
    if (held === null) return
    const before = coverageOf(held)

    const removed = new Set(
      (payload.repositories_removed ?? []).map((repo) => normalizedRepo(repo.full_name)),
    )
    const kept = (held.repos ?? []).filter(
      (fullName): fullName is string => fullName !== null && !removed.has(normalizedRepo(fullName)),
    )
    const added = (payload.repositories_added ?? []).map((repo) => normalizedRepo(repo.full_name))

    const repos = [...new Set([...kept.map(normalizedRepo), ...added])]
    await db.orm.public.GithubAppInstallation.where({ installationId }).update({ repos })
    await this.markChangedDue({ before, after: coverageOf({ ...held, repos }) })
  }

  private remember(args: { installationId: bigint }): void {
    this.known.set(String(args.installationId), Date.now() + KNOWN_INSTALLATION_TTL_MS)
  }

  private async coverageOf(args: { installationId: bigint }): Promise<RepoCoverage> {
    const row = await db.orm.public.GithubAppInstallation.first({
      installationId: args.installationId,
    })
    return row === null ? new Set() : coverageOf(row)
  }

  private async markChangedDue(args: { before: RepoCoverage; after: RepoCoverage }): Promise<void> {
    const repoFullNames = reposWithChangedCoverage(args)
    if (repoFullNames.length === 0) return
    await markReposTargetsDue({ repoFullNames, now: new Date() })
  }
}
