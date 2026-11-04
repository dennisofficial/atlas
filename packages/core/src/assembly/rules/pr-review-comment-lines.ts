import { reviewCommentPlace } from '../../github/comment-text'
import type { DraftOfType } from '../../events/envelope'

type PrEvent = DraftOfType<'pr-event'>

const rangeOf = (event: PrEvent): string => {
  if (event.startLine === undefined || event.line === undefined) return ''
  return event.startLine < event.line ? ` (lines ${event.startLine}-${event.line})` : ''
}

export const reviewCommentLocation = (event: PrEvent): string => {
  const place = reviewCommentPlace({ path: event.path, line: event.line })
  if (place === undefined) return ''
  const side = event.side === 'LEFT' ? ' (old side)' : ''
  return ` on ${place}${rangeOf(event)}${side}`
}

export const reviewCommentReply = (event: PrEvent): string =>
  event.inReplyTo === undefined ? '' : ` (reply to comment ${event.inReplyTo})`

export const reviewCommentHunk = (event: PrEvent): string =>
  event.diffHunk === undefined || event.diffHunk.trim() === ''
    ? ''
    : `\n\`\`\`diff\n${event.diffHunk}\n\`\`\``
