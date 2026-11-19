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
    const url = urlOfRemote.get(remote) ?? urlOfRemote.get(DEFAULT_REMOTE)
    if (url === undefined) continue
    const headRepo = githubRepoOfRemoteUrl(url)
    if (headRepo === null) continue
    heads.push({ headRepo, branch })
  }
  return heads
}
