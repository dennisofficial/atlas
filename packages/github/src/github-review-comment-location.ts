import type { GithubPrEventPayload } from './github-realtime.types'
import type { GithubWebhookReviewComment } from './github-webhook.types'

const HUNK_LINES = 12
const HUNK_CLIP = 1_500

const positive = (value: number | null | undefined): number | undefined =>
  value !== null && value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined

function hunkTail(hunk: string | null | undefined): string | undefined {
  const trimmed = hunk?.trimEnd() ?? ''
  if (trimmed === '') return undefined
  const tail = trimmed.split('\n').slice(-HUNK_LINES).join('\n')
  return tail.length <= HUNK_CLIP ? tail : tail.slice(tail.length - HUNK_CLIP)
}

export function reviewCommentLocationOf(
  comment: GithubWebhookReviewComment,
): Partial<GithubPrEventPayload> {
  const line = positive(comment.line) ?? positive(comment.original_line)
  const startLine = positive(comment.start_line)
  const diffHunk = hunkTail(comment.diff_hunk)
  const replyTo = positive(comment.in_reply_to_id)
  return {
    ...(comment.path ? { path: comment.path } : {}),
    ...(line === undefined ? {} : { line }),
    ...(startLine === undefined ? {} : { startLine }),
    ...(comment.side ? { side: comment.side } : {}),
    ...(diffHunk === undefined ? {} : { diffHunk }),
    ...(replyTo === undefined ? {} : { inReplyTo: String(replyTo) }),
  }
}
