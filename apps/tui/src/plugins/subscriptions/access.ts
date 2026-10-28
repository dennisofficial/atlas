import type { NoticePort } from '@dltech/atlas-core'
import type { SubscriptionRegistryPort } from '@dltech/atlas-harness'

import { createSubscriptionActions, type SubscriptionActions } from './actions'
import type { VisibleThread } from './visible-thread'

export type SubscriptionsAccess = {
  registry: SubscriptionRegistryPort
  visible: VisibleThread
  actions: SubscriptionActions
  subscribe: (listener: () => void) => () => void
  version: () => number
}

export const createSubscriptionsAccess = (args: {
  registry: SubscriptionRegistryPort
  visible: VisibleThread
  notice: NoticePort
}): SubscriptionsAccess => {
  const { registry } = args

  return {
    registry,
    visible: args.visible,
    actions: createSubscriptionActions({ registry, notice: args.notice }),
    subscribe: (listener) => registry.onChange(listener),
    version: () => registry.version(),
  }
}
