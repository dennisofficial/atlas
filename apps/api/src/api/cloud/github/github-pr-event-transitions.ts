import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'

export type PrTransitionSnapshot = {
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksIgnored: number
  mergeable: boolean | null
}

export type PrTransitionEvent = {
  kind: EPrEventKind
  payload: GithubPrEventPayload
  dedupeKey: string
}

export type PrVerdictTiming = 'fail-fast' | 'settled'

export type PrTransitionOptions = {
  verdictTiming?: PrVerdictTiming
  repoFullName?: string
  prNumber?: number
}

/**
 * A transition event exists only where the new snapshot crossed a boundary the prior one had
 * not; a steady-state re-read emits nothing. `prior` null means the row is brand new, and a
 * freshly-tracked PR does not announce a state it already had. Verdicts are an exception: the
 * per-head ledger (github-pr-head-checks.ts) owes them on any settled observation, so verdicts
 * are discharged outside this diff. Mergeability splits the same way: a conflict is announced the
 * moment it appears, while turning mergeable rides the verdict that closes CI.
 */
function completedCount(snapshot: PrTransitionSnapshot): number {
  return snapshot.checksPassed + snapshot.checksFailed + snapshot.checksIgnored
}

function hasChecks(snapshot: PrTransitionSnapshot): boolean {
  return snapshot.checksRunning > 0 || completedCount(snapshot) > 0
}

/**
 * A green verdict closing CI is where "mergeable" belongs, so the two arrive as one notice: a PR
 * that turns mergeable while checks run, or after they settled, never gets a second line saying so.
 */
export function verdictMergeability(next: PrTransitionSnapshot): { mergeable?: true } {
  return next.mergeable === true ? { mergeable: true } : {}
}

export function transitionsOf(args: {
  prior: PrTransitionSnapshot | null
  next: PrTransitionSnapshot & { url: string }
  options?: PrTransitionOptions
}): PrTransitionEvent[] {
  if (args.prior === null) return []

  const verdictTiming = args.options?.verdictTiming ?? 'fail-fast'
  const events: PrTransitionEvent[] = []
  const checksSettled = args.next.checksRunning === 0 && completedCount(args.next) > 0
  const settledFromRunning = checksSettled && args.prior.checksRunning > 0
  const completedMore = completedCount(args.next) > completedCount(args.prior)
  const failureAlreadyAnnounced = args.next.checksFailed > 0 && args.prior.checksFailed > 0

  if (verdictTiming === 'fail-fast') {
    if (args.next.checksFailed > 0 && args.prior.checksFailed === 0) {
      events.push(
        eventOf(args, EPrEventKind.Verdict, 'failed-first', {
          verdict: 'failed',
          settled: args.next.checksRunning === 0,
        }),
      )
    } else if (settledFromRunning && (!failureAlreadyAnnounced || completedMore)) {
      events.push(
        eventOf(args, EPrEventKind.Verdict, 'settled-running', {
          verdict: args.next.checksFailed > 0 ? 'failed' : 'green',
          settled: true,
        }),
      )
    }
  } else if (settledFromRunning) {
    events.push(
      eventOf(args, EPrEventKind.Verdict, 'settled-running', {
        verdict: args.next.checksFailed > 0 ? 'failed' : 'green',
        settled: true,
      }),
    )
  }

  const announcesNewTip =
    args.prior.headSha !== args.next.headSha &&
    checksSettled &&
    !events.some((event) => event.kind === EPrEventKind.Verdict)
  if (announcesNewTip) {
    events.push(
      eventOf(args, EPrEventKind.Verdict, 'new-tip', {
        verdict: args.next.checksFailed > 0 ? 'failed' : 'green',
        settled: true,
      }),
    )
  }

  const mergeable = args.next.mergeable
  if (
    mergeable !== null &&
    mergeable !== args.prior.mergeable &&
    (mergeable === false || !hasChecks(args.next))
  ) {
    events.push(eventOf(args, EPrEventKind.Mergeability, String(mergeable), { mergeable }))
  }

  if (args.prior.state !== args.next.state) {
    if (args.next.state === 'merged' || args.next.state === 'closed') {
      events.push(eventOf(args, EPrEventKind.State, args.next.state, { state: args.next.state }))
    }
  }

  return events
}

function eventOf(
  args: { next: PrTransitionSnapshot & { url: string }; options?: PrTransitionOptions },
  kind: EPrEventKind,
  verdictKey: string,
  payload: Omit<GithubPrEventPayload, 'url' | 'headSha'>,
): PrTransitionEvent {
  return {
    kind,
    payload: { url: args.next.url, headSha: args.next.headSha, ...payload },
    dedupeKey: dedupeKeyOf(args, kind, verdictKey),
  }
}

function dedupeKeyOf(
  args: { next: PrTransitionSnapshot; options?: PrTransitionOptions },
  kind: string,
  verdictKey: string,
): string {
  const repo = args.options?.repoFullName
  const pr = args.options?.prNumber
  if (repo === undefined || pr === undefined) return ''
  return [repo, pr, args.next.headSha, kind, verdictKey].join(':')
}
