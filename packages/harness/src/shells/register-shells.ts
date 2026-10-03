import { ClockPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import {
  instanceCachingFactory,
  portToken,
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
import { ExecutionLocationToken } from '../composition/execution-location-state'
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

  container.register(portToken(ShellRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const optional = <T>(token: InjectionToken<T>): T | undefined =>
        resolver.isRegistered(token, true) ? resolver.resolve(token) : undefined
      const operations = optional(portToken(LogPort))
      const registered = optional(portToken(EventLogPort))
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
      const clock = resolver.resolve(portToken(ClockPort))
      live = new BunShellRegistry({
        root: resolver.resolve(WorkspaceRoot),
        clock,
        hooks: resolver.resolve(HookChainSourceToken),
        launcher: durableLauncher({ container: resolver, clock }),
        sleepPrevention: optional(SleepPreventionToken),
        log,
        ids: optional(portToken(IdPort)),
        operations,
        threads: optional(portToken(ThreadStorePort)),
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
  if (container.isRegistered(portToken(ShellLauncherPort), true)) {
    return container.resolve(portToken(ShellLauncherPort))
  }
  if (!container.isRegistered(SessionRegistryToken, true)) return undefined
  if (!container.isRegistered(AtlasHomeToken, true)) return undefined
  if (!container.isRegistered(portToken(ProcessPort), true)) return undefined

  const sessions = container.resolve(SessionRegistryToken)
  const home = container.resolve(AtlasHomeToken)
  let supervisor: ReturnType<typeof prepareSupervisorLauncher> | undefined
  return new DurableShellLauncher({
    storage: new ShellStorage({ sessions }),
    sessions,
    processes: container.resolve(portToken(ProcessPort)),
    supervisor: () => {
      supervisor ??= prepareSupervisorLauncher({ home }).catch((error: unknown) => {
        supervisor = undefined
        throw error
      })
      return supervisor
    },
    now: () => clock.now(),
    locationOf: container.isRegistered(ExecutionLocationToken, true)
      ? (threadId) => {
          const location = container.resolve(ExecutionLocationToken).state
          return location.of(threadId) ?? location.current()
        }
      : undefined,
  })
}
