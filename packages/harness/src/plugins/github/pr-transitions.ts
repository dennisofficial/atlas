import type { BeforeTurn } from '@dltech/atlas-core'

import type { PullRequestService } from './pull-request-service'
import { checkoutKey, EPullRequestLookup, type PullRequestReading } from './pure'

const label = (reading: PullRequestReading): string | null => {
  if (reading.lookup !== EPullRequestLookup.Found) return null

  const { pullRequest } = reading
  const { tally } = pullRequest
  const checks =
    tally.failed > 0
      ? `checks failing (${tally.failed} failed)`
      : tally.running > 0
        ? `checks running (${tally.running} running, ${tally.passed} passed)`
        : tally.passed > 0
          ? 'checks passing'
          : 'no checks'
  return `PR #${pullRequest.number} (${pullRequest.title}): ${pullRequest.state}, ${checks}`
}

/**
 * Buffers one line per PR-state transition on the tracked checkout and hands them to the model
 * at the start of the next turn, so CI lands in context as it happens instead of the model
 * tracking it with its own shells. Transitions only — a steady reading is never repeated, so a
 * chatty check_run stream cannot fill context.
 *
 * The buffer is fed by subscribing to the service, not by re-reading it in `beforeTurn`: a
 * transition that lands between turns (an SSE push, a poll tick) is captured the moment it
 * happens, and `beforeTurn` only drains. A push-fed port and the `gh` poller seed identically.
 */
export function createPullRequestTransitions(args: { service: PullRequestService }): {
  beforeTurn: BeforeTurn
} {
  const pending: string[] = []
  let lastKey: string | null = null
  let lastLabel: string | null = null

  args.service.subscribe(() => {
    const current = args.service.current()
    if (current === null) {
      lastKey = null
      lastLabel = null
      return
    }

    const key = checkoutKey(current.checkout)
    const note = label(current.reading)
    if (key !== lastKey) {
      lastKey = key
      lastLabel = note
      return
    }
    if (note === null || note === lastLabel) return

    lastLabel = note
    pending.push(note)
  })

  return {
    beforeTurn: async () => {
      if (pending.length === 0) return {}

      const notes = pending.splice(0, pending.length)
      return {
        additionalContext: `Pull request updates since your last turn:\n${notes.map((note) => `- ${note}`).join('\n')}`,
      }
    },
  }
}
