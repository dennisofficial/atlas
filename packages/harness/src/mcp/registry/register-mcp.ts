import { BeforeTurnHook, DynamicToolSource } from '@dltech/atlas-core'

import type { CloudSession } from '../../cloud/cloud-session'
import { registerDisposable } from '../../container/disposal'
import { portToken, type DependencyContainer } from '../../container/injection'
import {
  ClientVersionToken,
  CloudRequiredToken,
  CloudSessionStoreToken,
} from '../../container/tokens'
import {
  BuiltInMcpSource,
  CompatMcpSource,
  FileMcpSource,
  RemoteMcpSource,
  resolveMcpSpecs,
  type McpSource,
} from '../config'
import { HandleStore } from '../bridge/handle-store'
import { McpInstructionsHook } from '../instructions/instructions-hook'

const userSourcesFor = (args: {
  session: CloudSession | null
  clientVersion?: string
  cloudRequired: boolean
}): readonly McpSource[] => {
  if (args.session !== null) {
    const remote = new RemoteMcpSource({
      session: args.session,
      ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
    })
    return [remote, FileMcpSource.user()]
  }
  if (args.cloudRequired) return []
  return [FileMcpSource.user()]
}

export const mcpSourcesFor = (args: {
  session: CloudSession | null
  cwd: string
  clientVersion?: string
  cloudRequired?: boolean
}): readonly McpSource[] => [
  new BuiltInMcpSource(),
  ...userSourcesFor({
    session: args.session,
    cloudRequired: args.cloudRequired === true,
    ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
  }),
  FileMcpSource.project({ cwd: args.cwd }),
  new CompatMcpSource({ cwd: args.cwd }),
]

const sessionFrom = (container: DependencyContainer): CloudSession | null =>
  container.isRegistered(CloudSessionStoreToken, true)
    ? container.resolve(CloudSessionStoreToken).read()
    : null

const clientVersionFrom = (container: DependencyContainer): string =>
  container.isRegistered(ClientVersionToken, true) ? container.resolve(ClientVersionToken) : 'dev'

const cloudRequiredFrom = (container: DependencyContainer): boolean =>
  container.isRegistered(CloudRequiredToken, true) ? container.resolve(CloudRequiredToken)() : false

export async function registerMcp(args: {
  container: DependencyContainer
  cwd: string
}): Promise<HandleStore> {
  const resolved = await resolveMcpSpecs({
    sources: mcpSourcesFor({
      session: sessionFrom(args.container),
      cwd: args.cwd,
      clientVersion: clientVersionFrom(args.container),
      cloudRequired: cloudRequiredFrom(args.container),
    }),
  })

  const store = new HandleStore({ specs: resolved.specs })
  await store.connectAll()

  args.container.register(portToken(DynamicToolSource), { useValue: store })
  args.container.register(portToken(BeforeTurnHook), { useValue: new McpInstructionsHook({ store }) })
  registerDisposable({ container: args.container, close: () => store.closeAll() })

  return store
}
