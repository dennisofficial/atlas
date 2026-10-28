import { useMemo, useSyncExternalStore } from 'react'

import type { ThreadId } from '@dltech/atlas-core'
import type { SubscriptionView } from '@dltech/atlas-harness'

import type { SubscriptionsAccess } from './access'

const NO_VIEWS: readonly SubscriptionView[] = []

const NEVER_CHANGES = (): (() => void) => () => undefined

const ZERO = (): string => ''

const NO_THREAD = (): undefined => undefined

export function useSubscriptionState(access: SubscriptionsAccess | null): {
  views: readonly SubscriptionView[]
  threadId: ThreadId | undefined
} {
  const version = useSyncExternalStore(access?.subscribe ?? NEVER_CHANGES, access?.version ?? ZERO)
  const threadId = useSyncExternalStore(
    access?.visible.subscribe ?? NEVER_CHANGES,
    access?.visible.threadId ?? NO_THREAD,
  )
  const views = useMemo(
    () => (access === null ? NO_VIEWS : access.registry().list()),
    [access, version],
  )

  return { views, threadId }
}
