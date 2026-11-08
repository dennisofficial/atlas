import { subscribeCommand, unsubscribeCommand } from './commands'
import { subscriptionsView } from './subscriptions-view'

export * from './ci-watch'
export * from './commands'
export * from './subscriptions-view'
export * from './target'

export const githubCoreSlots = {
  events: [] as readonly never[],
  views: [subscriptionsView],
  commands: [subscribeCommand, unsubscribeCommand],
} as const
