import {
  checkReconcileEffectsOf,
  latestCheckAttempts,
  type CheckIdentity,
} from '@dltech/atlas-core'

import type { PrOutboxEffect } from './github-pr-outbox'

function fingerprintOf(attempts: readonly CheckIdentity[]): string {
  return JSON.stringify(
    latestCheckAttempts({ attempts })
      .map((attempt) => [
        attempt.name,
        attempt.appSlug ?? '',
        attempt.checkKey,
        attempt.outcome,
        attempt.sourceCreatedAt ?? '',
      ])
      .sort(),
  )
}

export function reconcileOutboxEffectsOf(args: {
  attempts: readonly CheckIdentity[]
  repoFullName: string
  headSha: string
}): PrOutboxEffect[] {
  const fingerprint = fingerprintOf(args.attempts)

  return checkReconcileEffectsOf(args).map((effect) => ({
    kind: 'reconcile-checks',
    payload: { repoFullName: effect.repoFullName, headSha: effect.headSha },
    dedupeKey: `reconcile-checks:${effect.repoFullName}:${effect.headSha}:${fingerprint}`,
  }))
}
