import { z } from 'zod'

import { canonicalJson } from './canonical'
import type { V2Event } from './event'

export const observedBranchSchema = z
  .object({ name: z.string().min(1), sha: z.string().min(1) })
  .strict()

export const observedWorktreeSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().min(1).nullable(),
    sha: z.string().min(1),
    detached: z.boolean(),
  })
  .strict()

export const branchesObservedSchema = z.object({
  type: z.literal('branches-observed'),
  repo: z.string().min(1),
  head: z.string().min(1).nullable(),
  branches: z.array(observedBranchSchema),
  worktrees: z.array(observedWorktreeSchema),
})

export type ObservedBranch = z.infer<typeof observedBranchSchema>
export type ObservedWorktree = z.infer<typeof observedWorktreeSchema>
export type BranchesObserved = z.infer<typeof branchesObservedSchema>

export type BranchObservation = {
  repo: string
  head: string | null
  branches: ObservedBranch[]
  worktrees: ObservedWorktree[]
}

const byName = (left: ObservedBranch, right: ObservedBranch): number =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0

const byPath = (left: ObservedWorktree, right: ObservedWorktree): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0

export const canonicalObservation = (observation: BranchObservation): string =>
  canonicalJson({
    head: observation.head,
    branches: [...observation.branches].sort(byName),
    worktrees: [...observation.worktrees].sort(byPath),
  })

export const branchesChanged = (args: {
  events: readonly V2Event[]
  set: BranchObservation
}): boolean => {
  const last = args.events.findLast(
    (event) => event.type === 'branches-observed' && event.repo === args.set.repo,
  )
  if (last === undefined || last.type !== 'branches-observed') return true
  return canonicalObservation(last) !== canonicalObservation(args.set)
}
