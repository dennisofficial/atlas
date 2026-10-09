import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'

export type PrTransitionSnapshot = {
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
}

export type PrTransitionEvent = {
  kind: EPrEventKind
  payload: GithubPrEventPayload
}

export type PrVerdictTiming = 'fail-fast' | 'settled'

/**
 * A transition event exists only where the new snapshot crossed a boundary the prior one had
 * not; a steady-state re-read emits nothing. `prior` null means the row is brand new, and a
 * freshly-tracked PR does not announce a state it already had.
 */
export function transitionsOf(args: {
  prior: PrTransitionSnapshot | null
  next: PrTransitionSnapshot & { url: string }
  options?: { verdictTiming?: PrVerdictTiming }
}): PrTransitionEvent[] {
  if (args.prior === null) return []

  const verdictTiming = args.options?.verdictTiming ?? 'fail-fast'
  const events: PrTransitionEvent[] = []
  const checksSettled =
    args.next.checksRunning === 0 && args.next.checksPassed + args.next.checksFailed > 0
  const settledFromRunning = checksSettled && args.prior.checksRunning > 0

  if (verdictTiming === 'fail-fast') {
    if (args.next.checksFailed > 0 && args.prior.checksFailed === 0) {
      events.push({
        kind: EPrEventKind.Verdict,
        payload: { url: args.next.url, verdict: 'failed', headSha: args.next.headSha },
      })
    } else if (settledFromRunning && args.next.checksFailed === 0) {
      events.push({
        kind: EPrEventKind.Verdict,
        payload: { url: args.next.url, verdict: 'green', headSha: args.next.headSha },
      })
    }
  } else if (settledFromRunning) {
    events.push({
      kind: EPrEventKind.Verdict,
      payload: {
        url: args.next.url,
        verdict: args.next.checksFailed > 0 ? 'failed' : 'green',
        headSha: args.next.headSha,
      },
    })
  }

  const checksQuiet =
    args.next.checksRunning === 0 || args.next.checksPassed + args.next.checksFailed === 0
  if (args.next.mergeable !== null && args.prior.mergeable !== args.next.mergeable && checksQuiet) {
    events.push({
      kind: EPrEventKind.Mergeability,
      payload: { url: args.next.url, mergeable: args.next.mergeable, headSha: args.next.headSha },
    })
  }

  if (args.prior.state !== args.next.state) {
    if (args.next.state === 'merged' || args.next.state === 'closed') {
      events.push({
        kind: EPrEventKind.State,
        payload: { url: args.next.url, state: args.next.state, headSha: args.next.headSha },
      })
    }
  }

  return events
}
