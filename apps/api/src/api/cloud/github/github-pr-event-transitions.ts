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

/**
 * A transition event exists only where the new snapshot crossed a boundary the prior one had
 * not; a steady-state re-read emits nothing. `prior` null means the row is brand new, and a
 * freshly-tracked PR does not announce a state it already had.
 */
export function transitionsOf(args: {
  prior: PrTransitionSnapshot | null
  next: PrTransitionSnapshot & { url: string }
}): PrTransitionEvent[] {
  if (args.prior === null) return []

  const events: PrTransitionEvent[] = []
  const checksSettled =
    args.next.checksRunning === 0 && args.next.checksPassed + args.next.checksFailed > 0

  if (args.next.checksFailed > 0 && args.prior.checksFailed === 0) {
    events.push({
      kind: EPrEventKind.Verdict,
      payload: { url: args.next.url, verdict: 'failed', headSha: args.next.headSha },
    })
  } else if (checksSettled && args.prior.checksRunning > 0 && args.next.checksFailed === 0) {
    events.push({
      kind: EPrEventKind.Verdict,
      payload: { url: args.next.url, verdict: 'green', headSha: args.next.headSha },
    })
  }

  if (args.next.mergeable !== null && args.prior.mergeable !== args.next.mergeable) {
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
