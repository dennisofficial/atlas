import type { ActiveWorktree } from '@dltech/atlas-core'

import type { DeclaredPlace } from './place'

export const placeOf = (args: {
  projectDirectory: string
  activeWorktree: ActiveWorktree | undefined
}): DeclaredPlace => ({
  root: args.projectDirectory,
  ...(args.activeWorktree === undefined ? {} : { branch: args.activeWorktree.branch }),
})
