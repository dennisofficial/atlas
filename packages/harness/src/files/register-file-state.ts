import { AgentFileSystemPort } from '@dltech/atlas-core'

import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
} from '../container/injection'
import { FileReadStatePort, InMemoryFileReadState } from './read-state'
import { FileWriteGuardPort, VerifyingWriteGuard } from './write-guard'

export function registerFileState({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(FileReadStatePort), {
    useFactory: instanceCachingFactory(() => new InMemoryFileReadState()),
  })
  container.register(registeredPortToken(FileWriteGuardPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new VerifyingWriteGuard(
          resolver.resolve(registeredPortToken(FileReadStatePort)),
          resolver.resolve(registeredPortToken(AgentFileSystemPort)),
        ),
    ),
  })
}
