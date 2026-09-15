import { ClockPort, ProcessPort } from '@dltech/atlas-core'

import { registerDisposable } from '../container/disposal'
import { instanceCachingFactory, portToken, type DependencyContainer } from '../container/injection'
import { WorkspaceRoot } from '../container/tokens'
import { atlasBinDirectory, atlasServicesDirectory } from '../store/paths'
import { tryEnsureAtlasSvcShim } from './atlas-svc-shim'
import { BunServiceRegistry, ServiceRegistryPort } from './service-registry'

export function registerServices({ container }: { container: DependencyContainer }): void {
  let live: ServiceRegistryPort | undefined

  tryEnsureAtlasSvcShim({ binDirectory: atlasBinDirectory() })

  container.register(portToken(ServiceRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      live = new BunServiceRegistry({
        root: resolver.resolve(WorkspaceRoot),
        clock: resolver.resolve(portToken(ClockPort)),
        logsDirectory: atlasServicesDirectory(),
        processes: resolver.resolve(portToken(ProcessPort)),
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
