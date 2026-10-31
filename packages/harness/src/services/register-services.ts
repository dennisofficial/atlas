import { ClockPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
  type InjectionToken,
} from '../container/injection'
import { DeltaChannelToken, WorkspaceRoot } from '../container/tokens'
import { ExecutionLocationToken } from '../composition/execution-location-state'
import { threadProjectDirectory } from '../files/thread-project-directory'
import { ThreadStorePort } from '../store/thread-store'
import { atlasBinDirectory, atlasServicesDirectory } from '../store/paths'
import { tryEnsureAtlasSvcShim } from './atlas-svc-shim'
import { BunServiceRegistry, ServiceRegistryPort } from './service-registry'

export function registerServices({ container }: { container: DependencyContainer }): void {
  let live: ServiceRegistryPort | undefined

  tryEnsureAtlasSvcShim({ binDirectory: atlasBinDirectory() })

  container.register(registeredPortToken(ServiceRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const optional = <T>(token: InjectionToken<T>): T | undefined =>
        resolver.isRegistered(token, true) ? resolver.resolve(token) : undefined
      const operations = optional(registeredPortToken(LogPort))
      const log = withEventsAppendedPublishing({
        log: resolver.resolve(registeredPortToken(EventLogPort)),
        channel: () =>
          container.isRegistered(DeltaChannelToken, true)
            ? container.resolve(DeltaChannelToken)
            : undefined,
        onListenerError: (cause) =>
          operations?.warn({
            source: 'services.publication',
            message: 'a channel listener threw on an events-appended publication',
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      })
      live = new BunServiceRegistry({
        root: async () => {
          const launchDirectory = resolver.resolve(WorkspaceRoot)
          const threadId = resolver.isRegistered(ExecutionLocationToken, true)
            ? resolver.resolve(ExecutionLocationToken).state.activeThread()
            : undefined
          if (threadId === undefined) return launchDirectory
          return threadProjectDirectory({
            threadId,
            log: resolver.resolve(registeredPortToken(EventLogPort)),
            threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
            launchDirectory,
          })
        },
        clock: resolver.resolve(registeredPortToken(ClockPort)),
        logsDirectory: atlasServicesDirectory(),
        processes: resolver.resolve(registeredPortToken(ProcessPort)),
        recording: { log, ids: resolver.resolve(registeredPortToken(IdPort)) },
        warn: (message) => operations?.warn({ source: 'services.journal', message }),
      })
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
