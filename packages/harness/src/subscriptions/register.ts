import { ToolDefinition } from '@dltech/atlas-core'

import { portToken, registeredPortToken, type DependencyContainer } from '../container/injection'
import { ThreadStorePort } from '../store/thread-store'
import { SubscribeTool } from '../tools/builtin/subscribe'
import { SubscriptionListTool } from '../tools/builtin/subscription-list'
import { UnsubscribeTool } from '../tools/builtin/unsubscribe'
import { SubscriptionRegistryPort } from './port'
import type { SubscriptionToolDeps } from './tool-deps'
import { createThreadKinds, type ThreadKinds } from './thread-owner'

export function registerSubscriptionTools({ container }: { container: DependencyContainer }): void {
  let owners: ThreadKinds | undefined
  const deps = (resolver: DependencyContainer): SubscriptionToolDeps => ({
    registry: () => resolver.resolve(registeredPortToken(SubscriptionRegistryPort)),
    owners: {
      ownerOf: (args) => {
        owners ??= createThreadKinds({
          threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
        })
        return owners.ownerOf(args)
      },
    },
  })

  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new SubscribeTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new UnsubscribeTool(deps(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new SubscriptionListTool(deps(resolver)),
  })
}
