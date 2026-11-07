import type { ObservedBranch, ObservedWorktree } from '../branches'
import type { V2Event } from '../event'

type BranchesObservedEvent = Extract<V2Event, { type: 'branches-observed' }>

export type RepoObservation = {
  repo: string
  head: string | null
  base: string | null
  branches: readonly ObservedBranch[]
  worktrees: readonly ObservedWorktree[]
  changedAt: Readonly<Record<string, number>>
}

export type CheckoutsState = { repos: readonly RepoObservation[] }

export type CheckoutBranch = { name: string; sha: string; worktreePath: string | null }

export type RepoCheckout = {
  repo: string
  base: string | null
  head: string | null
  branches: readonly CheckoutBranch[]
}

export type CheckoutsView = {
  repos: readonly RepoCheckout[]
  primary: { repo: string; branch: string } | null
}

export const initialCheckoutsState: CheckoutsState = { repos: [] }

const changedAtOf = (args: {
  previous: RepoObservation | undefined
  event: BranchesObservedEvent
}): Record<string, number> => {
  const { previous, event } = args
  const before = new Map(previous?.branches.map((branch) => [branch.name, branch.sha]))
  const changedAt: Record<string, number> = {}
  for (const branch of event.branches) {
    const kept = previous?.changedAt[branch.name]
    changedAt[branch.name] =
      before.get(branch.name) === branch.sha && kept !== undefined ? kept : event.seq
  }
  return changedAt
}

export const stepCheckouts = (
  state: CheckoutsState,
  event: BranchesObservedEvent,
): CheckoutsState => {
  const previous = state.repos.find((repo) => repo.repo === event.repo)
  const observation: RepoObservation = {
    repo: event.repo,
    head: event.head,
    base: event.base ?? null,
    branches: event.branches,
    worktrees: event.worktrees,
    changedAt: changedAtOf({ previous, event }),
  }
  if (previous === undefined) return { repos: [...state.repos, observation] }
  return { repos: state.repos.map((repo) => (repo === previous ? observation : repo)) }
}

const worktreePathOf = (args: { observation: RepoObservation; name: string }): string | null =>
  args.observation.worktrees.find(
    (worktree) =>
      worktree.branch === args.name &&
      worktree.path !== args.observation.repo &&
      !worktree.detached,
  )?.path ?? null

const listedBranches = (observation: RepoObservation): CheckoutBranch[] => {
  if (observation.base === null) return []
  return observation.branches
    .filter((branch) => branch.name !== observation.base)
    .map((branch) => ({
      name: branch.name,
      sha: branch.sha,
      worktreePath: worktreePathOf({ observation, name: branch.name }),
    }))
}

const primaryBranchOf = (observation: RepoObservation): string | null => {
  if (observation.base === null) return null
  if (observation.head !== null && observation.head !== observation.base) return observation.head
  let latest: { name: string; seq: number } | null = null
  for (const branch of listedBranches(observation)) {
    const seq = observation.changedAt[branch.name] ?? 0
    if (latest === null || seq > latest.seq) latest = { name: branch.name, seq }
  }
  return latest?.name ?? null
}

export const checkoutsOf = (state: CheckoutsState): CheckoutsView => {
  let primary: CheckoutsView['primary'] = null
  for (const observation of state.repos) {
    const branch = primaryBranchOf(observation)
    if (branch === null) continue
    primary = { repo: observation.repo, branch }
    break
  }
  return {
    repos: state.repos.map((observation) => ({
      repo: observation.repo,
      base: observation.base,
      head: observation.head,
      branches: listedBranches(observation),
    })),
    primary,
  }
}
