import type { Row } from '@dltech/atlas-db'
import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'

type Tally = Pick<Row<'GithubPrState'>, 'checksPassed' | 'checksFailed' | 'checksRunning'>

const tallyText = (tally: Tally | null): string =>
  tally === null
    ? ''
    : ` (${tally.checksPassed} passed, ${tally.checksFailed} failed, ${tally.checksRunning} running)`

const failedNames = (payload: GithubPrEventPayload): string => {
  const names = (payload.failedChecks ?? []).map((check) => check.name)
  return names.length === 0 ? '' : ` Failed: ${names.join(', ')}.`
}

const verdictText = (args: { payload: GithubPrEventPayload; tally: Tally | null }): string => {
  if (args.payload.verdict === 'green') return `checks passed${tallyText(args.tally)}.`
  const progress =
    args.payload.settled === false ? 'a check failed, others still running' : 'checks failed'
  return `${progress}${tallyText(args.tally)}.${failedNames(args.payload)}`
}

const discussionText = (args: { kind: EPrEventKind; payload: GithubPrEventPayload }): string => {
  const author = args.payload.authorLogin === undefined ? '' : ` from @${args.payload.authorLogin}`
  if (args.kind === EPrEventKind.Review) {
    return `new review${author}${args.payload.reviewState === undefined ? '' : `: ${args.payload.reviewState}`}.`
  }
  return `${args.kind === EPrEventKind.ReviewComment ? 'new review comment' : 'new comment'}${author}.`
}

export const v2NoticeText = (args: {
  kind: EPrEventKind
  prNumber: number
  payload: GithubPrEventPayload
  tally: Tally | null
}): string => {
  const head = `GitHub: PR #${args.prNumber} (${args.payload.url})`
  if (args.kind === EPrEventKind.State) return `${head} was ${args.payload.state ?? 'updated'}.`
  if (args.kind === EPrEventKind.Mergeability) {
    return `${head} ${args.payload.mergeable === false ? 'has merge conflicts' : 'is mergeable'}.`
  }
  if (args.kind === EPrEventKind.Verdict) return `${head}: ${verdictText(args)}`
  return `${head}: ${discussionText(args)}`
}
