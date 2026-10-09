import type { AfterTurn, BeforeTurn } from '@dltech/atlas-core'

import { probeCheckout } from './checkout-probe'
import { checkoutKey, type RepositoryCheckout } from './pure'
import type { PullRequestService } from './pull-request-service'
import type { SessionFacts } from './session'

export type CheckoutTracking = {
  beforeTurn: BeforeTurn
  afterTurn: AfterTurn
  boot: () => Promise<void>
}

/**
 * The serve process has no surface to call `track`, so the hooks do it: the first turn probes the
 * directory the session works in (a real checkout inside a sandbox, where `git` answers) and every
 * turn end re-probes, because the model can `git checkout -b` mid-turn. The refresh is awaited on
 * a branch hop so `record-pull-request`, which sorts after this hook, reads the new branch's
 * answer rather than an empty slot. Locally the surface has already tracked by the time a turn
 * runs, so both halves no-op.
 */
export function createCheckoutTracking(args: {
  service: PullRequestService
  facts: SessionFacts
  cloud?: () => RepositoryCheckout | null
  probe?: typeof probeCheckout
}): CheckoutTracking {
  const probe = args.probe ?? probeCheckout

  const follow = async (request: { directory: string }): Promise<RepositoryCheckout | null> => {
    if (args.cloud !== undefined) {
      // The arrival/lift marker is a snapshot: a thread that reaches the cloud before its
      // worktree exists folds null forever unless the sandbox's real directory is probed.
      const folded = args.cloud()
      if (folded === null) {
        const probed = await probe({ directory: request.directory })
        if (probed === null) {
          args.service.stopTracking()
          return null
        }
        const tracked = args.service.current()
        if (tracked !== null && checkoutKey(tracked.checkout) === checkoutKey(probed)) return null

        args.service.track({ checkout: probed })
        return probed
      }
      const tracked = args.service.current()
      if (tracked !== null && checkoutKey(tracked.checkout) === checkoutKey(folded)) return null

      args.service.track({ checkout: folded })
      return folded
    }

    const probed = await probe({ directory: request.directory })
    if (probed === null) return null

    const tracked = args.service.current()
    if (tracked !== null && checkoutKey(tracked.checkout) === checkoutKey(probed)) return null

    args.service.track({ checkout: probed })
    return probed
  }

  return {
    /**
     * A clientless serve boot reaches no hook until the first turn, so the launch directory is
     * probed once at compose — the same probe the turn hooks use, restricted to the caller that
     * only fires it when a pushing port is in play. A directory that is not a checkout is a no-op
     * rather than a `stopTracking`: boot must not undo tracking a live surface set up.
     */
    boot: async () => {
      if (args.service.current() !== null) return

      await follow({ directory: args.facts.directory() })
    },
    beforeTurn: async ({ projectDirectory }) => {
      if (args.service.current() !== null) return {}

      await follow({ directory: projectDirectory })
      return {}
    },
    afterTurn: async () => {
      const probed = await follow({ directory: args.facts.directory() })
      if (probed !== null) await args.service.refresh({ checkout: probed, force: true })

      return {}
    },
  }
}
