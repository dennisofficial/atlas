import { systemNotice } from '../../context/envelope'
import { EPrEventKind, EPrVerdict } from '../../events/body'
import type { DraftOfType } from '../../events/envelope'

const BODY_CLIP = 400

type PrEvent = DraftOfType<'pr-event'>

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

const fromAuthor = ({ noun, event }: { noun: string; event: PrEvent }): string => {
  const said = event.authorLogin === undefined ? noun : `${noun} from ${event.authorLogin}`
  return event.edited === true ? `${said} edited` : said
}

const withBody = ({ lead, event }: { lead: string; event: PrEvent }): string => {
  const body = event.body?.trim() ?? ''
  const said = body === '' ? `${lead}.` : `${lead} — ${clip(body, BODY_CLIP)}.`
  return `${said} ${event.url}`
}

const SHORT_SHA_LENGTH = 7

const tipSuffix = (event: PrEvent): string =>
  event.headSha === undefined || event.headSha.length < SHORT_SHA_LENGTH
    ? ''
    : ` on ${event.headSha.slice(0, SHORT_SHA_LENGTH)}`

const verdictSentence = (event: PrEvent): string => {
  if (event.verdict === EPrVerdict.Green)
    return `CI finished, all checks passed${tipSuffix(event)}.`
  if (event.verdict === EPrVerdict.Failed && event.settled === true)
    return `CI finished, checks failed${tipSuffix(event)}. ${event.url}`
  if (event.verdict === EPrVerdict.Failed && event.settled === false)
    return `a check failed${tipSuffix(event)} while CI is still running; another notice follows when CI finishes. ${event.url}`
  if (event.verdict === EPrVerdict.Failed) return `checks failed${tipSuffix(event)}. ${event.url}`
  return `checks reported. ${event.url}`
}

const mergeabilitySentence = (event: PrEvent): string => {
  if (event.mergeable === true) return 'now mergeable.'
  if (event.mergeable === false) return 'now has merge conflicts.'
  return 'mergeability unknown.'
}

const stateSentence = (event: PrEvent): string => {
  if (event.state === undefined) return 'state changed.'
  if (event.state === 'merged' || event.state === 'closed') return `now ${event.state}.`
  return `state is now ${event.state}.`
}

const reviewLead = (event: PrEvent): string => {
  const review = fromAuthor({ noun: 'review', event })
  return event.reviewState === undefined ? review : `${review} (${event.reviewState})`
}

const sentenceOf = (event: PrEvent): string => {
  if (event.kind === EPrEventKind.Comment) {
    return withBody({ lead: fromAuthor({ noun: 'comment', event }), event })
  }
  if (event.kind === EPrEventKind.ReviewComment) {
    return withBody({ lead: fromAuthor({ noun: 'review comment', event }), event })
  }
  if (event.kind === EPrEventKind.Review) return withBody({ lead: reviewLead(event), event })
  if (event.kind === EPrEventKind.Verdict) return verdictSentence(event)
  if (event.kind === EPrEventKind.Mergeability) return mergeabilitySentence(event)
  return stateSentence(event)
}

export function prEventContent(event: PrEvent): string {
  return `PR #${event.prNumber} in ${event.repo}: ${sentenceOf(event)}`
}

export function prEventBlock(event: PrEvent): string {
  return systemNotice({ kind: 'pr-event', content: prEventContent(event) })
}
