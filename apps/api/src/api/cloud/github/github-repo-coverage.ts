import { db } from '@dltech/atlas-db'
import { normalizedRepo } from './github-pr-identity'
import { ERepoHookStatus } from './github-realtime.types'

export type RepoCoverage = { covers: (repoFullName: string) => boolean }

export function coverageOf(args: {
  installationRepos: readonly string[]
  hookedRepos: readonly string[]
}): RepoCoverage {
  const covered = new Set([...args.installationRepos, ...args.hookedRepos].map(normalizedRepo))
  return { covers: (repoFullName) => covered.has(normalizedRepo(repoFullName)) }
}

/**
 * A repo whose events reach us as webhooks needs no polling: GitHub pushes every state change and
 * the inbox retries anything that failed. Only an uncovered repo (no app installation, no live
 * personal hook) still depends on the timer.
 */
export async function readRepoCoverage(): Promise<RepoCoverage> {
  const installations = await db.orm.public.GithubAppInstallation.select('repos')
    .where({ suspendedAt: null })
    .all()
  const hooks = await db.orm.public.GithubRepoHook.select('repoFullName')
    .where({ status: ERepoHookStatus.Active })
    .all()
  return coverageOf({
    installationRepos: installations.flatMap((installation) =>
      (installation.repos ?? []).filter((repo): repo is string => repo !== null),
    ),
    hookedRepos: hooks.map((hook) => hook.repoFullName),
  })
}
