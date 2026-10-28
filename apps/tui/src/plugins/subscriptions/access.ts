import type { NoticePort } from '@dltech/atlas-core'
import type { SubscriptionRegistryPort } from '@dltech/atlas-harness'

import { createSubscriptionActions, type SubscriptionActions } from './actions'
import type { VisibleThread } from './visible-thread'

export type SubscriptionsAccess = {
  registry: () => SubscriptionRegistryPort
  visible: VisibleThread
  actions: SubscriptionActions
  subscribe: (listener: () => void) => () => void
  version: () => string
}

export const createSubscriptionsAccess = (args: {
  fallback: SubscriptionRegistryPort
  active: () => SubscriptionRegistryPort | null
  onActiveChanged: (listener: () => void) => () => void
  visible: VisibleThread
  notice: NoticePort
}): SubscriptionsAccess => {
  const registry = (): SubscriptionRegistryPort => args.active() ?? args.fallback
  let switches = 0
  args.onActiveChanged(() => {
    switches += 1
  })

  return {
    registry,
    visible: args.visible,
    actions: createSubscriptionActions({ registry, notice: args.notice }),
    subscribe: (listener) => {
      let unwatch = registry().onChange(listener)
      const stopSwitching = args.onActiveChanged(() => {
        unwatch()
        unwatch = registry().onChange(listener)
        listener()
      })

      return () => {
        stopSwitching()
        unwatch()
      }
    },
    version: () => `${switches}:${registry().version()}`,
  }
}
