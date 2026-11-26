import { EMergeQueueMove, EPrEventKind, inboxEventPayloadOf } from '@dltech/atlas-core'

import { notifyPrSubscribers } from './github-pr-subscriber-notice'
import type { GithubMergeQueueEntryWebhookPayload } from './github-webhook.types'

const QUEUED_PR_IN_HEAD_REF = /\/pr-(\d+)-/

const moveOf = (action: string): EMergeQueueMove | null => {
  if (action === 'added') return EMergeQueueMove.Entered
  if (action === 'removed') return EMergeQueueMove.Left
  return null
}

/** GitHub Apps receive queue moves as `pull_request` actions; `merge_queue_entry` never arrives. */
export const mergeQueueMoveOfPullAction = (action: string): EMergeQueueMove | null => {
  if (action === 'enqueued') return EMergeQueueMove.Entered
  if (action === 'dequeued') return EMergeQueueMove.Left
  return null
}

/** A `removed` delivery may carry no `pull_request`; the queue head ref still names the PR. */
export function mergeQueuePrNumberOf(payload: GithubMergeQueueEntryWebhookPayload): number | null {
  const stated = payload.pull_request?.number
  if (stated !== undefined) return stated
  const match = QUEUED_PR_IN_HEAD_REF.exec(payload.merge_group?.head_ref ?? '')
  if (match === null) return null
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export const mergeQueueEventOf = (args: {
  repoFullName: string
  prNumber: number
  move: EMergeQueueMove
}): string =>
  inboxEventPayloadOf({
    event: {
      type: 'pr-event',
      repo: `github.com/${args.repoFullName}`,
      prNumber: args.prNumber,
      kind: EPrEventKind.MergeQueue,
      url: `https://github.com/${args.repoFullName}/pull/${args.prNumber}`,
      queue: args.move,
    },
  })

export async function recordMergeQueueEntry(args: {
  payload: GithubMergeQueueEntryWebhookPayload
  queues: (args: { repoFullName: string; prNumber: number; mergeQueued: boolean }) => Promise<void>
}): Promise<number> {
  const move = moveOf(args.payload.action)
  if (move === null) return 0
  const prNumber = mergeQueuePrNumberOf(args.payload)
  if (prNumber === null) return 0
  const repoFullName = args.payload.repository.full_name
  await args.queues({ repoFullName, prNumber, mergeQueued: move === EMergeQueueMove.Entered })
  return await notifyMergeQueueMove({ repoFullName, prNumber, move })
}

export async function notifyMergeQueueMove(args: {
  repoFullName: string
  prNumber: number
  move: EMergeQueueMove
}): Promise<number> {
  return await notifyPrSubscribers({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    payload: mergeQueueEventOf(args),
    what: `${args.move} the merge queue`,
  })
}
