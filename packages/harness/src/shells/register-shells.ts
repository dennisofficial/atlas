import { ClockPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import { instanceCachingFactory, portToken, type DependencyContainer } from '../container/injection'
import {
  DeltaChannelToken,
  HookChainSourceToken,
  HookChainToken,
  SleepPreventionToken,
  WorkspaceRoot,
} from '../container/tokens'
import { BunShellRegistry, ShellRegistryPort } from './shell-registry'

/**
 * The chain is bound as a thunk because the registry sits inside its own dependency graph: hooks
 * resolve tools, tools resolve this registry, and an eager binding would close that cycle. Nothing
 * reads it until a background shell ends.
 */
export function registerShells({ container }: { container: DependencyContainer }): void {
  let live: ShellRegistryPort | undefined

  container.register(HookChainSourceToken, {
    useValue: () => container.resolve(HookChainToken),
  })

  container.register(portToken(ShellRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const processes = resolver.isRegistered(portToken(ProcessPort), true)
        ? resolver.resolve(portToken(ProcessPort))
        : undefined
      const sleepPrevention = resolver.isRegistered(SleepPreventionToken, true)
        ? resolver.resolve(SleepPreventionToken)
        : undefined
      const registered = resolver.isRegistered(portToken(EventLogPort), true)
        ? resolver.resolve(portToken(EventLogPort))
        : undefined
      const operations = resolver.isRegistered(portToken(LogPort), true)
        ? resolver.resolve(portToken(LogPort))
        : undefined
      const log =
        registered === undefined
          ? undefined
          : withEventsAppendedPublishing({
              log: registered,
              channel: () =>
                container.isRegistered(DeltaChannelToken, true)
                  ? container.resolve(DeltaChannelToken)
                  : undefined,
              onListenerError: (cause) =>
                operations?.warn({
                  source: 'shells.publication',
                  message: 'a channel listener threw on an events-appended publication',
                  error: cause instanceof Error ? cause.message : String(cause),
                  ...(cause instanceof Error && cause.stack !== undefined
                    ? { stack: cause.stack }
                    : {}),
                }),
            })
      const ids = resolver.isRegistered(portToken(IdPort), true)
        ? resolver.resolve(portToken(IdPort))
        : undefined
      live = new BunShellRegistry(
        resolver.resolve(WorkspaceRoot),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(HookChainSourceToken),
        processes,
        sleepPrevention,
        log,
        ids,
        undefined,
        operations,
      )
      return live
    }),
  })

  registerDisposable({
    container,
    close: async () => {
      await live?.closeAll()
    },
  })
}
