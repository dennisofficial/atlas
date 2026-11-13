import { ERepoTracking } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'
import { ERepoHookStatus } from './github-realtime.types'

export { ERepoTracking }

export type RepoCoverage = { covers: (repoFullName: string) => boolean }

export type RepoTracking = { trackingOf: (repoFullName: string) => ERepoTracking }

export function trackingOf(args: {
  installationRepos: readonly string[]
  hookedRepos: readonly string[]
}): RepoTracking {
  const installed = new Set(args.installationRepos.map(normalizedRepo))
  const hooked = new Set(args.hookedRepos.map(normalizedRepo))
  return {
    trackingOf: (repoFullName) => {
      const repo = normalizedRepo(repoFullName)
      if (installed.has(repo)) return ERepoTracking.App
      if (hooked.has(repo)) return ERepoTracking.User
      return ERepoTracking.Polled
    },
  }
}

export function coverageOf(args: {
  installationRepos: readonly string[]
  hookedRepos: readonly string[]
}): RepoCoverage {
  const tracking = trackingOf(args)
  return { covers: (repoFullName) => tracking.trackingOf(repoFullName) !== ERepoTracking.Polled }
}

/**
 * A repo whose events reach us as webhooks needs no polling: GitHub pushes every state change and
 * the inbox retries anything that failed. Only an uncovered repo (no app installation, no live
 * personal hook) still depends on the timer.
 */
export async function readRepoCoverage(): Promise<RepoCoverage> {
  return coverageOf(await readSources())
}

export async function readRepoTracking(): Promise<RepoTracking> {
  return trackingOf(await readSources())
}

async function readSources(): Promise<{ installationRepos: string[]; hookedRepos: string[] }> {
  const installations = await db.orm.public.GithubAppInstallation.select('repos')
    .where({ suspendedAt: null })
    .all()
  const hooks = await db.orm.public.GithubRepoHook.select('repoFullName')
    .where({ status: ERepoHookStatus.Active })
    .all()
  return {
    installationRepos: installations.flatMap((installation) =>
      (installation.repos ?? []).filter((repo): repo is string => repo !== null),
    ),
    hookedRepos: hooks.map((hook) => hook.repoFullName),
  }
}
