import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { SUBSCRIPTIONS_VIEW, subscriptionsViewSchema, type SubscriptionRow } from '../core'

export const githubClient: ClientSlot = {
  hooks: [
    { name: 'github-subscriptions', appliesTo: (event) => event.type.startsWith('subscription-') },
  ],
}

export const subscriptionsOfView = (
  views: Readonly<Record<string, unknown>>,
): readonly SubscriptionRow[] =>
  pluginViewOf({ views, name: SUBSCRIPTIONS_VIEW, schema: subscriptionsViewSchema }) ?? []
