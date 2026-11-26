import { systemNotice } from '../../context/envelope'
import { EMergeQueueMove, EPrEventKind, EPrVerdict } from '../../events/body'
import type { DraftOfType } from '../../events/envelope'
import { stripHtmlComments } from '../../github/comment-text'
import { clipText } from '../../text/clip-text'
import {
  reviewCommentHunk,
  reviewCommentLocation,
  reviewCommentReply,
} from './pr-review-comment-lines'
import { failedChecksBlock, failedChecksCountPhrase } from './pr-failed-checks-lines'

const BODY_CLIP = 4000

type PrEvent = DraftOfType<'pr-event'>

const fromAuthor = ({ noun, event }: { noun: string; event: PrEvent }): string => {
  const said = event.authorLogin === undefined ? noun : `${noun} from ${event.authorLogin}`
  return event.edited === true ? `${said} edited` : said
}

const withBody = ({ lead, event }: { lead: string; event: PrEvent }): string => {
  const body = stripHtmlComments(event.body ?? '').trim()
  const said = body === '' ? `${lead}.` : `${lead} — ${clipText({ text: body, limit: BODY_CLIP })}.`
  return `${said} ${event.url}`
}

const SHORT_SHA_LENGTH = 7

const tallySuffix = (event: PrEvent): string => {
  const checks = event.checks
  if (checks === undefined) return ''
  return ` (${checks.passed} passed, ${checks.failed} failed, ${checks.running} running)`
}

const tipSuffix = (event: PrEvent): string =>
  event.headSha === undefined || event.headSha.length < SHORT_SHA_LENGTH
    ? ''
    : ` on ${event.headSha.slice(0, SHORT_SHA_LENGTH)}`

const STILL_QUEUED =
  ' The PR is still in the merge queue. A failed check on the PR head does not remove it. A notice follows when it merges or leaves the queue.'

const queuedSuffix = (event: PrEvent): string => (event.mergeQueued === true ? STILL_QUEUED : '')

const failedVerdictSentence = (event: PrEvent): string => {
  const failed = event.failedChecks ?? []
  const queued = queuedSuffix(event)
  if (event.settled === true) {
    const lead = failed.length === 0 ? 'checks failed' : failedChecksCountPhrase(failed)
    return `CI finished, ${lead}${tallySuffix(event)}${tipSuffix(event)}.${queued} ${event.url}`
  }
  if (event.settled === false) {
    const lead = failed.length === 0 ? 'a check failed' : failedChecksCountPhrase(failed)
    return `${lead}${tallySuffix(event)}${tipSuffix(event)}. CI is still running, and another notice follows when it finishes.${queued} ${event.url}`
  }
  return `checks failed${tallySuffix(event)}${tipSuffix(event)}.${queued} ${event.url}`
}

const verdictSentence = (event: PrEvent): string => {
  if (event.verdict === EPrVerdict.Green) {
    const mergeable = event.mergeable === true ? ' and the PR is mergeable' : ''
    return `CI finished, all checks passed${tallySuffix(event)}${tipSuffix(event)}${mergeable}.`
  }
  if (event.verdict === EPrVerdict.Failed) {
    return `${failedVerdictSentence(event)}${failedChecksBlock({ checks: event.failedChecks, repo: event.repo })}`
  }
  return `checks reported. ${event.url}`
}

const mergeabilitySentence = (event: PrEvent): string => {
  if (event.mergeable === true) return 'now mergeable.'
  if (event.mergeable === false) {
    return event.baseBranch === undefined
      ? 'now has merge conflicts.'
      : `now has merge conflicts with ${event.baseBranch}.`
  }
  return 'mergeability unknown.'
}

const stateSentence = (event: PrEvent): string => {
  if (event.state === undefined) return 'state changed.'
  if (event.state === 'merged' || event.state === 'closed') return `now ${event.state}.`
  return `state is now ${event.state}.`
}

const mergeQueueSentence = (event: PrEvent): string => {
  if (event.queue === EMergeQueueMove.Entered) {
    return 'entered the merge queue. GitHub merges it when the queue checks pass. If GitHub removes it, a "left the merge queue" notice follows.'
  }
  if (event.queue === EMergeQueueMove.Left) {
    return 'left the merge queue and will not merge on its own.'
  }
  return 'merge queue membership changed.'
}

const autoMergeOffSentence = (event: PrEvent): string => {
  const reason = event.reason === undefined ? '' : ` (GitHub: ${event.reason})`
  return `auto-merge is now off${reason}. The PR will not merge on its own.`
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
    const lead = `${fromAuthor({ noun: 'review comment', event })}${reviewCommentLocation(event)}${reviewCommentReply(event)}`
    return `${withBody({ lead, event })}${reviewCommentHunk(event)}`
  }
  if (event.kind === EPrEventKind.Review) return withBody({ lead: reviewLead(event), event })
  if (event.kind === EPrEventKind.Verdict) return verdictSentence(event)
  if (event.kind === EPrEventKind.Mergeability) return mergeabilitySentence(event)
  if (event.kind === EPrEventKind.MergeQueue) return mergeQueueSentence(event)
  if (event.kind === EPrEventKind.AutoMergeOff) return autoMergeOffSentence(event)
  return stateSentence(event)
}

export function prEventContent(event: PrEvent): string {
  return `PR #${event.prNumber} in ${event.repo}: ${sentenceOf(event)}`
}

export function prEventBlock(event: PrEvent): string {
  return systemNotice({ kind: 'pr-event', content: prEventContent(event) })
}
