import { ClockPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registerDisposable } from '../container/disposal'
import {
  instanceCachingFactory,
  portToken,
  type DependencyContainer,
  type InjectionToken,
} from '../container/injection'
import { DeltaChannelToken, WorkspaceRoot } from '../container/tokens'
import { atlasBinDirectory, atlasServicesDirectory } from '../store/paths'
import { tryEnsureAtlasSvcShim } from './atlas-svc-shim'
import { BunServiceRegistry, ServiceRegistryPort } from './service-registry'

export function registerServices({ container }: { container: DependencyContainer }): void {
  let live: ServiceRegistryPort | undefined

  tryEnsureAtlasSvcShim({ binDirectory: atlasBinDirectory() })

  container.register(portToken(ServiceRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const optional = <T>(token: InjectionToken<T>): T | undefined =>
        resolver.isRegistered(token, true) ? resolver.resolve(token) : undefined
      const operations = optional(portToken(LogPort))
      const log = withEventsAppendedPublishing({
        log: resolver.resolve(portToken(EventLogPort)),
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
        root: resolver.resolve(WorkspaceRoot),
        clock: resolver.resolve(portToken(ClockPort)),
        logsDirectory: atlasServicesDirectory(),
        processes: resolver.resolve(portToken(ProcessPort)),
        recording: { log, ids: resolver.resolve(portToken(IdPort)) },
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
