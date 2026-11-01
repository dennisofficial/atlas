import { EventLogPort, IdPort, LogPort, OnThreadOpenHook, type ThreadId } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { PrSubscriptionClient } from '../cloud/pr-subscription-client'
import { registerDisposable } from '../container/disposal'
import { portToken, registeredPortToken, type DependencyContainer } from '../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  DeltaChannelToken,
  ServeSessionToken,
} from '../container/tokens'
import { SubscriptionRegistryPort } from '../subscriptions/port'
import { SubscriptionRegistry } from '../subscriptions/registry'
import type { SubscriptionProvider } from '../subscriptions/provider'
import { timerSchedule } from '../subscriptions/schedule'
import { SubscriptionThreadOpenHook } from '../subscriptions/thread-open-hook'
import { createThreadKinds, teammatesOf } from '../subscriptions/thread-owner'
import { ThreadStorePort } from '../store/thread-store'

export async function bindSubscriptions(args: {
  container: DependencyContainer
  providers: readonly SubscriptionProvider[]
  launchThreadId: ThreadId | undefined
}): Promise<SubscriptionRegistry> {
  const { container } = args
  const logPort = container.resolve(registeredPortToken(LogPort))

  const session = container.isRegistered(ServeSessionToken, true)
    ? container.resolve(ServeSessionToken)
    : container.isRegistered(CloudSessionStoreToken, true)
      ? container.resolve(CloudSessionStoreToken).read()
      : null
  const ackClient =
    session === null
      ? undefined
      : new PrSubscriptionClient({
          session,
          clientVersion: container.resolve(ClientVersionToken),
        })

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
    ...(ackClient === undefined
      ? {}
      : {
          ackPrEvents: ({ threadId, eventIds }: { threadId: ThreadId; eventIds: string[] }) => {
            void ackClient.ackEvents({ threadId, eventIds }).catch((cause: unknown) =>
              logPort.warn({
                source: 'subscriptions',
                message: `could not ack ${eventIds.length} pr-event(s): ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              }),
            )
          },
        }),
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

  if (args.launchThreadId !== undefined) {
    const owners = [
      args.launchThreadId,
      ...(await teammatesOf({ threads, threadId: args.launchThreadId })),
    ]
    await Promise.all(owners.map((threadId) => registry.load({ threadId })))
  }
  return registry
}
