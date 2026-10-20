import { AgentFileSystemPort, FileSystemPort, ProcessPort } from '@dltech/atlas-core'

import {
  instanceCachingFactory,
  registeredPortToken,
  resolveIfPossible,
  type DependencyContainer,
} from '../container/injection'
import { DockerEngineToken, SessionRegistryToken } from '../container/tokens'
import { DEFAULT_DOCKER_SOCKET, DockerEngine } from './docker/engine'
import { LocalFileSystemPort } from './local-filesystem'
import { LocalProcessPort } from './local-process'
import { LoginEnvProcessPort } from './login-env-process'
import { SessionEnvironmentProcessPort } from './session-environment'

export function registerExecution({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(ProcessPort), {
    useFactory: (resolver) => {
      const local = new LoginEnvProcessPort(new LocalProcessPort())
      const sessions = resolveIfPossible({ container: resolver, token: SessionRegistryToken })
      return sessions === undefined ? local : new SessionEnvironmentProcessPort({ inner: local, sessions })
    },
  })
  container.register(registeredPortToken(FileSystemPort), { useClass: LocalFileSystemPort })
  container.register(registeredPortToken(AgentFileSystemPort), {
    useFactory: (resolver) => resolver.resolve(registeredPortToken(FileSystemPort)),
  })
  container.register(DockerEngineToken, {
    useFactory: instanceCachingFactory(
      () =>
        new DockerEngine({ socketPath: process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET }),
    ),
  })
}
