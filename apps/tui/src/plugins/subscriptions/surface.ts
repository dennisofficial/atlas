import { useMemo } from 'react'

import type { ContributedSurface, PluginSurface } from '../surface'
import type { SubscriptionsAccess } from './access'
import { subscriptionsSection } from './subscription-rows'
import { useSubscriptionState } from './use-subscription-state'

export const subscriptionsSurface = (args: { access: SubscriptionsAccess }): ContributedSurface => {
  const { actions } = args.access

  return {
    pluginId: 'subscriptions',
    use: (): PluginSurface => {
      const { views, threadId } = useSubscriptionState(args.access)

      const sidebarSection = useMemo(
        () =>
          threadId === undefined
            ? null
            : subscriptionsSection({
                views,
                threadId,
                onToggle: actions.toggle,
                onRemove: actions.remove,
              }),
        [views, threadId],
      )

      return useMemo(() => ({ sidebarSection }), [sidebarSection])
    },
  }
}
