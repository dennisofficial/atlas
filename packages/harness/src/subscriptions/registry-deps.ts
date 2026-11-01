import type { EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

import type { Schedule } from './delivery-buffer'
import type { SubscriptionProvider } from './provider'
import type { ThreadKinds } from './thread-owner'

export type SubscriptionRegistryDeps = {
  log: EventLogPort
  ids: IdPort
  owners: ThreadKinds
  providers: readonly SubscriptionProvider[]
  now: () => number
  schedule: Schedule
  warn?: ((message: string) => void) | undefined
  newId?: (() => string) | undefined
  ackPrEvents?: ((args: { threadId: ThreadId; eventIds: string[] }) => void) | undefined
}
