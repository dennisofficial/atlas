import type { GithubDeliveryService } from './github-delivery.service'
import type {
  GithubMergeQueueEntryWebhookPayload,
  GithubWorkflowRunWebhookPayload,
} from './github-webhook.types'
import { recordMergeQueueEntry } from './github-merge-queue-webhook'
import { recordWorkflowRunFinished } from './github-workflow-run-webhook'

/**
 * The two deliveries that are not PR-state transitions: a finished workflow run owes a thread its
 * notice, and a merge-queue entry is a notice of its own. Both arrived on a per-repo personal hook
 * before the app existed, so both ingress routes share this one dispatch.
 */
export async function handleSupplementaryEvent(args: {
  event: string
  payload: unknown
  deliveries: { applyMergeQueued: GithubDeliveryService['applyMergeQueued'] }
}): Promise<boolean> {
  if (args.event === 'workflow_run') {
    await recordWorkflowRunFinished({
      payload: args.payload as GithubWorkflowRunWebhookPayload,
    })
    return true
  }
  if (args.event === 'merge_queue_entry') {
    await recordMergeQueueEntry({
      payload: args.payload as GithubMergeQueueEntryWebhookPayload,
      queues: async (move) => await args.deliveries.applyMergeQueued(move),
    })
    return true
  }
  return false
}
