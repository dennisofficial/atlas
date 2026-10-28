import { ESubscriptionActor, ESubscriptionStatus, toThreadId } from '@dltech/atlas-core'
import { PULL_REQUEST_PROVIDER_KIND, type SubscriptionView } from '@dltech/atlas-harness'

export const THREAD = toThreadId('thread-a')

export const OTHER_THREAD = toThreadId('thread-b')

export const REPO = 'github.com/o/r'

export const view = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: 'sub-1',
  provider: PULL_REQUEST_PROVIDER_KIND,
  target: { repo: REPO, number: 7 },
  label: 'o/r#7',
  threadId: THREAD,
  createdBy: ESubscriptionActor.Agent,
  status: ESubscriptionStatus.Active,
  createdAt: '2026-10-28T10:00:00.000Z',
  held: 0,
  ...over,
})
