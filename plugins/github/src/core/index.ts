import { setSubscriptionStatusCommand, subscribeCommand, unsubscribeCommand } from './commands'
import { subscriptionsView } from './subscriptions-view'

export * from './ci-watch'
export * from './commands'
export * from './event-catalog'
export * from './presentation'
export * from './run-target'
export * from './subscription-end-rules'
export * from './subscriptions-view'
export * from './target'

export const githubCoreSlots = {
  events: [] as readonly never[],
  views: [subscriptionsView],
  commands: [subscribeCommand, unsubscribeCommand, setSubscriptionStatusCommand],
} as const
