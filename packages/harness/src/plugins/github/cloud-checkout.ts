import { liftedWorkspaceOf } from '@dltech/atlas-core'
import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-wire'

import { defineProjection, type PluginProjection } from '../projection'
import { checkoutKey, checkoutOf, type RepositoryCheckout } from './pure'

/**
 * The lift event records no default branch, so the sandbox cannot distinguish "standing on the
 * default" from "working on a branch named like one" beyond these names — which is exactly the
 * case that makes the noise: a cloud session lands on the repo root's default before entering its
 * worktree.
 */
const CLOUD_DEFAULT_BRANCHES: ReadonlySet<string> = new Set(['main', 'master'])

const sameCheckout = (
  left: RepositoryCheckout | null,
  right: RepositoryCheckout | null,
): boolean => {
  if (left === null || right === null) return left === right
  return left.directory === right.directory && checkoutKey(left) === checkoutKey(right)
}

/**
 * The cloud thread's checkout, folded out of the log rather than probed: the lift records
 * remoteUrl and branch on its `location-changed`, and a host-side probe of a sandbox path can
 * only answer null. The reference is held steady across publishes so a republish of the same log
 * does not re-render the surfaces reading this.
 */
export function createCloudCheckout(): PluginProjection<RepositoryCheckout | null> {
  let folded: RepositoryCheckout | null = null

  return defineProjection<RepositoryCheckout | null>({
    id: 'cloud-checkout',
    fold: ({ events }) => {
      const lifted = liftedWorkspaceOf(events)
      const next =
        lifted === null
          ? null
          : checkoutOf({
              directory: lifted.cwd ?? CLOUD_WORKSPACE_PATH,
              branch: lifted.branch,
              remotes: [{ name: 'origin', url: lifted.remoteUrl }],
              defaultBranch: CLOUD_DEFAULT_BRANCHES.has(lifted.branch) ? lifted.branch : null,
            })

      if (sameCheckout(folded, next)) return folded
      folded = next
      return next
    },
  })
}
