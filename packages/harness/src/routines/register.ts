import { ToolDefinition } from '@dltech/atlas-core'

import { portToken, registeredPortToken, type DependencyContainer } from '../container/injection'
import { ClientVersionToken, CloudSessionStoreToken, ServeSessionToken } from '../container/tokens'
import { ThreadStorePort } from '../store/thread-store'
import { RoutineCreateTool } from '../tools/builtin/routine-create'
import { RoutineDeleteTool } from '../tools/builtin/routine-delete'
import { RoutineListTool } from '../tools/builtin/routine-list'
import { RoutineRunTool } from '../tools/builtin/routine-run'
import { RoutineUpdateTool } from '../tools/builtin/routine-update'
import { routineAccessOf } from './routine-access'
import type { RoutineToolDeps } from './tool-deps'

export function registerRoutineTools({ container }: { container: DependencyContainer }): void {
  const deps = (resolver: DependencyContainer): RoutineToolDeps => ({
    access: routineAccessOf({
      serveSession: resolver.isRegistered(ServeSessionToken, true)
        ? resolver.resolve(ServeSessionToken)
        : null,
      sessionStore: resolver.isRegistered(CloudSessionStoreToken, true)
        ? resolver.resolve(CloudSessionStoreToken)
        : null,
      threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
      clientVersion: resolver.isRegistered(ClientVersionToken, true)
        ? resolver.resolve(ClientVersionToken)
        : 'dev',
    }),
  })

  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new RoutineListTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new RoutineCreateTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new RoutineUpdateTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new RoutineDeleteTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new RoutineRunTool(deps(resolver)),
  })
}
