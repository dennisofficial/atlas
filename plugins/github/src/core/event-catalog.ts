import { EPrEventKind, type SubscriptionEventCatalog } from '@dltech/atlas-core'

import { GITHUB_RUN_PROVIDER } from './run-target'
import { GITHUB_PROVIDER } from './target'

export const PULL_REQUEST_EVENTS: SubscriptionEventCatalog = [
  { name: 'comments', summary: 'comments, reviews and review comments' },
  { name: 'ci', summary: 'CI verdicts' },
  { name: 'mergeability', summary: 'merge conflicts and merge queue' },
  { name: 'state', summary: 'merged, closed or reopened', alwaysDelivered: true },
]

export const WORKFLOW_RUN_EVENTS: SubscriptionEventCatalog = []

const PR_EVENT_GROUPS: Readonly<Record<EPrEventKind, string>> = {
  [EPrEventKind.Comment]: 'comments',
  [EPrEventKind.Review]: 'comments',
  [EPrEventKind.ReviewComment]: 'comments',
  [EPrEventKind.Verdict]: 'ci',
  [EPrEventKind.Mergeability]: 'mergeability',
  [EPrEventKind.MergeQueue]: 'mergeability',
  [EPrEventKind.State]: 'state',
}

export const prEventGroupOf = (kind: EPrEventKind): string => PR_EVENT_GROUPS[kind]

export const eventCatalogOf = (provider: string): SubscriptionEventCatalog => {
  if (provider === GITHUB_PROVIDER) return PULL_REQUEST_EVENTS
  if (provider === GITHUB_RUN_PROVIDER) return WORKFLOW_RUN_EVENTS
  return []
}
