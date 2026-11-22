import { isAbsolute, relative, resolve, sep } from 'node:path'
import { TRPCError } from '@trpc/server'
import type { WorktreeChangesRead } from '@dltech/atlas-control'

export const checkoutIn = (args: {
  checkouts: readonly WorktreeChangesRead[]
  checkoutId: string
}): WorktreeChangesRead => {
  const checkout = args.checkouts.find((row) => row.checkoutId === args.checkoutId)
  if (checkout === undefined)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown checkout' })
  return checkout
}

export const latestPerWorktree = (
  checkouts: readonly WorktreeChangesRead[],
): WorktreeChangesRead[] => {
  const latest = new Map<string, WorktreeChangesRead>()
  for (const checkout of checkouts) {
    const current = latest.get(checkout.worktreePath)
    if (current === undefined || checkout.updatedAt > current.updatedAt)
      latest.set(checkout.worktreePath, checkout)
  }
  return [...latest.values()]
}

export const changedPathsIn = (checkout: WorktreeChangesRead | undefined): ReadonlySet<string> =>
  new Set(checkout === undefined ? [] : checkout.files.map((file) => file.path))

export const resolveInside = (args: { root: string; path: string }): string => {
  const resolved = resolve(args.root, args.path === '' ? '.' : args.path)
  const inside = relative(args.root, resolved)
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'path outside the checkout' })
  return resolved
}
