import type { BeforeTurn, ThreadId } from '@dltech/atlas-core'

import type { FamilyTracker } from './family-tracker'
import type { PullRequestService } from './pull-request-service'
import { checkoutKey, EPullRequestLookup, type PullRequestReading } from './pure'

const SHORT_SHA_LENGTH = 7

const onTip = (pullRequest: { headSha?: string }): string =>
  pullRequest.headSha === undefined || pullRequest.headSha === '' ? '' : ` on ${pullRequest.headSha.slice(0, SHORT_SHA_LENGTH)}`

const label = (reading: PullRequestReading): string | null => {
  if (reading.lookup !== EPullRequestLookup.Found) return null

  const { pullRequest } = reading
  const { tally } = pullRequest
  const checks =
    tally.failed > 0
      ? `checks failing (${tally.failed} failed)${onTip(pullRequest)}`
      : tally.running > 0
        ? `checks running (${tally.running} running, ${tally.passed} passed)`
        : tally.passed > 0
          ? `checks passing${onTip(pullRequest)}`
          : 'no checks'
  return `PR #${pullRequest.number} (${pullRequest.title}): ${pullRequest.state}, ${checks}`
}

/**
 * Buffers one line per PR-state transition on each tracked checkout and hands them to the thread
 * standing on that checkout at the start of its next turn, so CI lands in context as it happens
 * instead of the model tracking it with its own shells. Transitions only — a steady reading is
 * never repeated, so a chatty check_run stream cannot fill context.
 *
 * The buffer is fed by subscribing to the service, not by re-reading it in `beforeTurn`: a
 * transition that lands between turns (an SSE push, a poll tick) is captured the moment it
 * happens, and `beforeTurn` only drains. A push-fed port and the `gh` poller seed identically.
 */
export function createPullRequestTransitions(args: {
  service: PullRequestService
  tracker: FamilyTracker
}): {
  beforeTurn: BeforeTurn
} {
  const pending = new Map<ThreadId, string[]>()
  const lastLabels = new Map<string, string | null>()

  args.service.subscribe(() => {
    const held = new Set<string>()
    for (const checkout of args.service.tracked()) {
      const key = checkoutKey(checkout)
      held.add(key)

      const note = label(args.service.snapshot({ key }))
      if (!lastLabels.has(key)) {
        lastLabels.set(key, note)
        continue
      }
      if (note === null || note === lastLabels.get(key)) continue

      lastLabels.set(key, note)
      for (const threadId of args.tracker.threadsOn({ key })) {
        pending.set(threadId, [...(pending.get(threadId) ?? []), note])
      }
    }
    for (const key of [...lastLabels.keys()]) {
      if (!held.has(key)) lastLabels.delete(key)
    }

    // The buffer above is keyed by the standing thread because this subscription is synchronous;
    // a subagent's notes are folded onto its owner as soon as the lookup resolves.
    void (async () => {
      for (const checkout of args.service.tracked()) {
        for (const threadId of args.tracker.threadsOn({ key: checkoutKey(checkout) })) {
          const owner = await args.tracker.ownerOf({ threadId })
          if (owner === threadId) continue

          const moved = pending.get(threadId)
          if (moved === undefined) continue
          pending.delete(threadId)
          pending.set(owner, [...(pending.get(owner) ?? []), ...moved])
        }
      }
    })()
  })

  return {
    beforeTurn: async ({ threadId }) => {
      const owner = await args.tracker.ownerOf({ threadId })
      if (owner !== threadId) {
        pending.delete(threadId)
        return {}
      }

      const notes = pending.get(owner)
      pending.delete(owner)
      if (notes === undefined || notes.length === 0) return {}

      return {
        additionalContext: `Pull request updates since your last turn:\n${notes.map((note) => `- ${note}`).join('\n')}`,
      }
    },
  }
}
