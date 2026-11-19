import { githubRepoOfRemoteUrl } from '../github/remote-repo'
import type { BranchObservation } from './branches'

const DEFAULT_REMOTE = 'origin'

export type WorkedHead = { headRepo: string; branch: string }

const namesOf = (observation: BranchObservation): readonly string[] => {
  const names = [
    observation.head,
    ...observation.worktrees.map((worktree) => worktree.branch),
    ...(observation.checkouts ?? []),
  ].filter((name): name is string => name !== null && name !== '')
  return [...new Set(names)]
}

const headRepoOf = (args: { remote: string; urlOfRemote: Map<string, string> }): string | null => {
  const direct = githubRepoOfRemoteUrl(args.remote)
  if (direct !== null) return direct
  const url = args.urlOfRemote.get(args.remote) ?? args.urlOfRemote.get(DEFAULT_REMOTE)
  return url === undefined ? null : githubRepoOfRemoteUrl(url)
}

export const workedHeadsOf = (args: {
  observation: BranchObservation
  base: string | null
}): WorkedHead[] => {
  const urlOfRemote = new Map(
    (args.observation.remotes ?? []).map((remote) => [remote.name, remote.url]),
  )
  const pushRemoteOfBranch = new Map(
    args.observation.branches.map((branch) => [branch.name, branch.pushRemote ?? null]),
  )
  const heads: WorkedHead[] = []
  for (const branch of namesOf(args.observation)) {
    if (branch === args.base) continue
    const remote = pushRemoteOfBranch.get(branch) ?? DEFAULT_REMOTE
    const headRepo = headRepoOf({ remote, urlOfRemote })
    if (headRepo === null) continue
    heads.push({ headRepo, branch })
  }
  return heads
}
