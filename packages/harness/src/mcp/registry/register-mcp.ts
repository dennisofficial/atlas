import { BeforeTurnHook, DynamicToolSource, SecretsPort } from '@dltech/atlas-core'

import type { CloudSession } from '../../cloud/cloud-session'
import { createUrlOpener } from '../../browser/open-url'
import { registerDisposable } from '../../container/disposal'
import { portToken, type DependencyContainer } from '../../container/injection'
import { ClientVersionToken, CloudSessionStoreToken, SecretsStoreToken } from '../../container/tokens'
import { SystemClock } from '../../store/clock'
import {
  BuiltInMcpSource,
  CompatMcpSource,
  FileMcpSource,
  RemoteMcpSource,
  resolveMcpSpecs,
  type McpRejection,
  type McpSource,
} from '../config'
import { HandleStore } from '../bridge/handle-store'
import { McpInstructionsHook } from '../instructions/instructions-hook'
import { OAuthCallbackServer } from '../oauth/callback-server'
import { McpOAuthFlow, type McpAuthResult } from '../oauth/flow'
import { McpOAuthStore } from '../oauth/token-store'

const userSourcesFor = (args: {
  session: CloudSession | null
  clientVersion?: string
}): readonly McpSource[] => {
  if (args.session !== null) {
    const remote = new RemoteMcpSource({
      session: args.session,
      ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
    })
    return [remote, FileMcpSource.user()]
  }
  return [FileMcpSource.user()]
}

export const mcpSourcesFor = (args: {
  session: CloudSession | null
  cwd: string
  clientVersion?: string
}): readonly McpSource[] => [
  new BuiltInMcpSource(),
  ...userSourcesFor({
    session: args.session,
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

export type RegisteredMcp = {
  store: HandleStore
  rejections: readonly McpRejection[]
  /** Drives an interactive sign-in for a server that answered 401; absent when there is no secrets store. */
  signIn: ((args: { serverUrl: string; wwwAuthenticate?: string }) => Promise<McpAuthResult>) | undefined
}

const oauthFlowFrom = (container: DependencyContainer): McpOAuthFlow | undefined => {
  if (!container.isRegistered(SecretsStoreToken, true)) return undefined
  const secrets = container.resolve(SecretsStoreToken)
  if (!(secrets instanceof SecretsPort)) return undefined
  return new McpOAuthFlow({
    store: new McpOAuthStore({ secrets }),
    callbacks: new OAuthCallbackServer(),
    clock: new SystemClock(),
    openBrowser: createUrlOpener(),
  })
}

export async function registerMcp(args: {
  container: DependencyContainer
  cwd: string
}): Promise<RegisteredMcp> {
  const resolved = await resolveMcpSpecs({
    sources: mcpSourcesFor({
      session: sessionFrom(args.container),
      cwd: args.cwd,
      clientVersion: clientVersionFrom(args.container),
    }),
  })

  const flow = oauthFlowFrom(args.container)
  const store = new HandleStore({
    specs: resolved.specs,
    ...(flow === undefined ? {} : { authFlow: flow }),
  })
  await store.connectAll()

  args.container.register(portToken(DynamicToolSource), { useValue: store })
  args.container.register(portToken(BeforeTurnHook), { useValue: new McpInstructionsHook({ store }) })
  registerDisposable({ container: args.container, close: () => store.closeAll() })

  const signIn =
    flow === undefined
      ? undefined
      : (signInArgs: { serverUrl: string; wwwAuthenticate?: string }) => flow.signIn(signInArgs)

  return { store, rejections: resolved.rejections, signIn }
}
