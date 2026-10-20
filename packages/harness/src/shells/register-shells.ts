import { ClockPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
  type InjectionToken,
} from '../container/injection'
import {
  AtlasHomeToken,
  DeltaChannelToken,
  HookChainSourceToken,
  HookChainToken,
  SessionRegistryToken,
  SleepPreventionToken,
  WorkspaceRoot,
} from '../container/tokens'
import { ThreadStorePort } from '../store/thread-store'
import { DurableShellLauncher } from './durable-launcher'
import { ShellLauncherPort, ShellRegistryPort } from './port'
import { BunShellRegistry } from './shell-registry'
import { ShellStorage } from './storage'
import { prepareSupervisorLauncher } from './supervisor-launch'

export function registerShells({ container }: { container: DependencyContainer }): void {
  let live: ShellRegistryPort | undefined

  container.register(HookChainSourceToken, {
    useValue: () => container.resolve(HookChainToken),
  })

  container.register(registeredPortToken(ShellRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const optional = <T>(token: InjectionToken<T>): T | undefined =>
        resolver.isRegistered(token, true) ? resolver.resolve(token) : undefined
      const operations = optional(registeredPortToken(LogPort))
      const registered = optional(registeredPortToken(EventLogPort))
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
      const clock = resolver.resolve(registeredPortToken(ClockPort))
      live = new BunShellRegistry({
        root: resolver.resolve(WorkspaceRoot),
        clock,
        hooks: resolver.resolve(HookChainSourceToken),
        launcher: durableLauncher({ container: resolver, clock }),
        sleepPrevention: optional(SleepPreventionToken),
        log,
        ids: optional(registeredPortToken(IdPort)),
        operations,
        threads: optional(registeredPortToken(ThreadStorePort)),
      })
      return live
    }),
  })

  registerDisposable({
    container,
    close: async () => {
      await live?.detachAll()
    },
  })
}

function durableLauncher(args: {
  container: DependencyContainer
  clock: ClockPort
}): ShellLauncherPort | undefined {
  const { container, clock } = args
  if (container.isRegistered(registeredPortToken(ShellLauncherPort), true)) {
    return container.resolve(registeredPortToken(ShellLauncherPort))
  }
  if (!container.isRegistered(SessionRegistryToken, true)) return undefined
  if (!container.isRegistered(AtlasHomeToken, true)) return undefined
  if (!container.isRegistered(registeredPortToken(ProcessPort), true)) return undefined

  const sessions = container.resolve(SessionRegistryToken)
  const home = container.resolve(AtlasHomeToken)
  let supervisor: ReturnType<typeof prepareSupervisorLauncher> | undefined
  return new DurableShellLauncher({
    storage: new ShellStorage({ sessions }),
    sessions,
    processes: container.resolve(registeredPortToken(ProcessPort)),
    supervisor: () => {
      supervisor ??= prepareSupervisorLauncher({ home }).catch((error: unknown) => {
        supervisor = undefined
        throw error
      })
      return supervisor
    },
    now: () => clock.now(),
  })
}
