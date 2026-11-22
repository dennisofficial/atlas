import type { SessionViewOutput } from '@dltech/atlas-protocol'

import type { CheckoutChanges } from '../changes/use-changes'

export type CheckoutOption = {
  id: string
  repo: string
  worktree: string
  path: string
  label: string
}

const NO_CHECKOUT_VIEW: SessionViewOutput['checkouts'] = { repos: [], primary: null }

const basenameOf = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

const branchNameOf = (args: {
  view: SessionViewOutput['checkouts']
  worktreePath: string
}): string | undefined =>
  args.view.repos
    .flatMap((repo) => repo.branches)
    .find((branch) => branch.worktreePath === args.worktreePath)?.name

const liveWorktreePathsOf = (view: SessionViewOutput['checkouts']): Set<string> | undefined => {
  if (view.repos.length === 0) return undefined
  const paths = new Set<string>()
  for (const repo of view.repos) {
    paths.add(repo.repo)
    for (const branch of repo.branches) {
      if (branch.worktreePath !== null) paths.add(branch.worktreePath)
    }
  }
  return paths
}

const newestPerWorktree = (checkouts: CheckoutChanges[]): CheckoutChanges[] => {
  const newest = new Map<string, CheckoutChanges>()
  for (const checkout of checkouts) {
    const kept = newest.get(checkout.worktreePath)
    if (kept === undefined || kept.updatedAt <= checkout.updatedAt) {
      newest.set(checkout.worktreePath, checkout)
    }
  }
  return [...newest.values()]
}

export function checkoutOptionsOf(args: {
  checkouts: CheckoutChanges[]
  view: SessionViewOutput['checkouts']
}): CheckoutOption[] {
  const live = liveWorktreePathsOf(args.view)
  const checkouts = newestPerWorktree(args.checkouts).filter(
    (checkout) => live === undefined || live.has(checkout.worktreePath),
  )
  return checkouts.map((checkout) => {
    const worktree = basenameOf(checkout.worktreePath)
    const branch = branchNameOf({ view: args.view, worktreePath: checkout.worktreePath })
    return {
      id: checkout.checkoutId,
      repo: checkout.repo,
      worktree,
      path: checkout.worktreePath,
      label: `${checkout.repo} · ${branch ?? worktree}`,
    }
  })
}

export function currentWorktreePathOf(
  checkouts: SessionViewOutput['checkouts'] = NO_CHECKOUT_VIEW,
): string | undefined {
  const primary = checkouts.primary
  if (primary === null) return undefined
  const repo = checkouts.repos.find((entry) => entry.repo === primary.repo)
  return repo?.branches.find((branch) => branch.name === primary.branch)?.worktreePath ?? undefined
}

export const defaultCheckoutIdOf = (args: {
  options: CheckoutOption[]
  currentWorktreePath?: string | undefined
}): string | undefined =>
  args.options.find((option) => option.path === args.currentWorktreePath)?.id ?? args.options[0]?.id
