import type { AfterTurn, BeforeTurn } from '@dltech/atlas-core'

import { probeCheckout } from './checkout-probe'
import { checkoutKey, type RepositoryCheckout } from './pure'
import type { PullRequestService } from './pull-request-service'
import type { SessionFacts } from './session'

export type CheckoutTracking = {
  beforeTurn: BeforeTurn
  afterTurn: AfterTurn
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
  probe?: typeof probeCheckout
}): CheckoutTracking {
  const probe = args.probe ?? probeCheckout

  const follow = async (request: { directory: string }): Promise<RepositoryCheckout | null> => {
    const probed = await probe({ directory: request.directory })
    if (probed === null) return null

    const tracked = args.service.current()
    if (tracked !== null && checkoutKey(tracked.checkout) === checkoutKey(probed)) return null

    args.service.track({ checkout: probed })
    return probed
  }

  return {
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
