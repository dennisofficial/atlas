import { BeforeTurnHook, DynamicToolSource } from '@dltech/atlas-core'

import { CloudClient } from '../../cloud/cloud-client'
import type { CloudSession } from '../../cloud/cloud-session'
import { registerDisposable } from '../../container/disposal'
import { portToken, type DependencyContainer } from '../../container/injection'
import { CloudSessionStoreToken } from '../../container/tokens'
import {
  BuiltInMcpSource,
  CompatMcpSource,
  FileMcpSource,
  RemoteMcpSource,
  resolveMcpSpecs,
  type McpSource,
} from '../config'
import { TrustResolver } from '../bridge/trust-resolver'
import { HandleStore } from '../bridge/handle-store'
import { McpInstructionsHook } from '../instructions/instructions-hook'
import { McpHandleTrust } from './workspace-boundary-hook'

export const mcpSourcesFor = (args: {
  session: CloudSession | null
  cwd: string
}): readonly McpSource[] => {
  const user =
    args.session === null
      ? FileMcpSource.user()
      : new RemoteMcpSource({
          client: new CloudClient({ url: args.session.url, token: args.session.token }),
          url: args.session.url,
        })

  return [
    new BuiltInMcpSource(),
    user,
    FileMcpSource.project({ cwd: args.cwd }),
    new CompatMcpSource({ cwd: args.cwd }),
  ]
}

const sessionFrom = (container: DependencyContainer): CloudSession | null =>
  container.isRegistered(CloudSessionStoreToken, true)
    ? container.resolve(CloudSessionStoreToken).read()
    : null

export async function registerMcp(args: {
  container: DependencyContainer
  cwd: string
}): Promise<HandleStore> {
  const resolved = await resolveMcpSpecs({
    sources: mcpSourcesFor({ session: sessionFrom(args.container), cwd: args.cwd }),
  })

  const store = new HandleStore({ specs: resolved.specs })
  await store.connectAll()

  args.container.register(portToken(DynamicToolSource), { useValue: store })
  args.container.register(portToken(McpHandleTrust), { useValue: new TrustResolver({ store }) })
  args.container.register(portToken(BeforeTurnHook), { useValue: new McpInstructionsHook({ store }) })
  registerDisposable({ container: args.container, close: () => store.closeAll() })

  return store
}
