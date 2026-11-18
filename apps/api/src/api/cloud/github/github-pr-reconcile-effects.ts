import { checkReconcileEffectsOf, type CheckIdentity } from '@dltech/atlas-core'

import type { PrOutboxEffect } from './github-pr-outbox'

export function reconcileOutboxEffectsOf(args: {
  attempts: readonly CheckIdentity[]
  repoFullName: string
  headSha: string
}): PrOutboxEffect[] {
  return checkReconcileEffectsOf(args).map((effect) => ({
    kind: 'reconcile-checks',
    payload: { repoFullName: effect.repoFullName, headSha: effect.headSha },
    dedupeKey: `reconcile-checks:${effect.repoFullName}:${effect.headSha}`,
  }))
}
