import type { AppendHook } from '@dltech/atlas-control'
import { workedHeadsOf } from '@dltech/atlas-core'

export const TRACKING_TARGET_TTL_MS = 7 * 24 * 60 * 60_000

export const trackingTargetHook: AppendHook = {
  name: 'github-tracking-targets',
  appliesTo: (event) => event.type === 'branches-observed',
  handle: async ({ tx, sessionId, event }) => {
    if (event.type !== 'branches-observed') return
    const session = await tx.readSession({ sessionId })
    if (session === undefined) return
    const liveUntil = new Date(Date.parse(event.at) + TRACKING_TARGET_TTL_MS).toISOString()
    for (const head of workedHeadsOf({ observation: event, base: event.base ?? null })) {
      await tx.upsertTrackingTarget({
        userId: session.userId,
        kind: 'head',
        repoFullName: head.headRepo,
        branch: head.branch,
        prNumber: null,
        liveUntil,
      })
    }
  },
}
