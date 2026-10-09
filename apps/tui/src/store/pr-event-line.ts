import { EPrEventKind, EPrReviewState, EPrVerdict, type EventOfType } from '@dltech/atlas-core'

type PrEvent = EventOfType<'pr-event'>

const LINE_CLIP = 120

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

const firstLineOf = (body: string | undefined): string => {
  const trimmed = body?.trim() ?? ''
  if (trimmed === '') return ''
  return clip(trimmed.split('\n')[0] ?? '', LINE_CLIP)
}

const withBody = (lead: string, body: string | undefined): string => {
  const first = firstLineOf(body)
  return first === '' ? lead : `${lead} — ${first}`
}

const author = (event: PrEvent): string => event.authorLogin ?? 'someone'

const commentLine = (event: PrEvent): string =>
  withBody(`${prefix(event)}: ${author(event)} commented`, event.body)

const reviewLead = (event: PrEvent): string => {
  if (event.reviewState === EPrReviewState.Approved) return `${author(event)} approved`
  if (event.reviewState === EPrReviewState.ChangesRequested) {
    return `${author(event)} requested changes`
  }
  return `${author(event)} reviewed`
}

const reviewLine = (event: PrEvent): string => withBody(`${prefix(event)}: ${reviewLead(event)}`, undefined)

const reviewCommentLine = (event: PrEvent): string =>
  withBody(`${prefix(event)}: ${author(event)} left an inline review comment`, event.body)

const verdictLine = (event: PrEvent): string => {
  if (event.verdict === EPrVerdict.Failed) return `${prefix(event)}: CI failed`
  return `${prefix(event)}: CI green`
}

const mergeabilityLine = (event: PrEvent): string =>
  event.mergeable === false ? `${prefix(event)}: has conflicts` : `${prefix(event)}: mergeable`

const stateLine = (event: PrEvent): string => {
  if (event.state === 'merged') return `${prefix(event)}: merged`
  if (event.state === 'closed') return `${prefix(event)}: closed`
  return `${prefix(event)}: state changed to ${event.state ?? 'unknown'}`
}

const prefix = (event: PrEvent): string => `PR #${event.prNumber}`

export const prEventLine = (event: PrEvent): string => {
  if (event.kind === EPrEventKind.Comment) return commentLine(event)
  if (event.kind === EPrEventKind.Review) return reviewLine(event)
  if (event.kind === EPrEventKind.ReviewComment) return reviewCommentLine(event)
  if (event.kind === EPrEventKind.Verdict) return verdictLine(event)
  if (event.kind === EPrEventKind.Mergeability) return mergeabilityLine(event)
  return stateLine(event)
}

export const prEventFailed = (event: PrEvent): boolean =>
  (event.kind === EPrEventKind.Verdict && event.verdict === EPrVerdict.Failed) ||
  (event.kind === EPrEventKind.Review && event.reviewState === EPrReviewState.ChangesRequested) ||
  (event.kind === EPrEventKind.Mergeability && event.mergeable === false)
