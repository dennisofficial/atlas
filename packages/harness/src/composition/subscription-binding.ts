import { EventLogPort, IdPort, LogPort, OnThreadOpenHook, type ThreadId } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import { portToken, registeredPortToken, type DependencyContainer } from '../container/injection'
import { DeltaChannelToken } from '../container/tokens'
import { SubscriptionRegistryPort } from '../subscriptions/port'
import { SubscriptionRegistry } from '../subscriptions/registry'
import type { SubscriptionProvider } from '../subscriptions/provider'
import { timerSchedule } from '../subscriptions/schedule'
import { SubscriptionThreadOpenHook } from '../subscriptions/thread-open-hook'
import { createThreadKinds } from '../subscriptions/thread-owner'
import { ThreadStorePort } from '../store/thread-store'

export async function bindSubscriptions(args: {
  container: DependencyContainer
  providers: readonly SubscriptionProvider[]
  launchThreadId: ThreadId | undefined
}): Promise<SubscriptionRegistry> {
  const { container } = args
  const logPort = container.resolve(registeredPortToken(LogPort))

  const registry = new SubscriptionRegistry({
    log: withEventsAppendedPublishing({
      log: container.resolve(registeredPortToken(EventLogPort)),
      channel: () =>
        container.isRegistered(DeltaChannelToken, true)
          ? container.resolve(DeltaChannelToken)
          : undefined,
    }),
    ids: container.resolve(registeredPortToken(IdPort)),
    owners: createThreadKinds({ threads: container.resolve(registeredPortToken(ThreadStorePort)) }),
    providers: args.providers,
    now: () => Date.now(),
    schedule: timerSchedule,
    warn: (message) => logPort.warn({ source: 'subscriptions', message }),
  })

  container.register(registeredPortToken(SubscriptionRegistryPort), { useValue: registry })
  container.register(portToken(OnThreadOpenHook), {
    useValue: new SubscriptionThreadOpenHook(registry),
  })
  const threads = container.resolve(registeredPortToken(ThreadStorePort))
  const stopWatchingRewinds = threads.onRewound?.(({ threadId }) => {
    void registry.reload({ threadId })
  })
  registerDisposable({
    container,
    close: async () => {
      stopWatchingRewinds?.()
      registry.dispose()
    },
  })

  if (args.launchThreadId !== undefined) await registry.load({ threadId: args.launchThreadId })
  return registry
}
