import { BeforeTurnHook, DynamicToolSource } from '@dltech/atlas-core'

import { createUrlOpener } from '../../browser/open-url'
import { registerDisposable } from '../../container/disposal'
import { portToken, type DependencyContainer } from '../../container/injection'
import { SecretsStoreToken } from '../../container/tokens'
import { SystemClock } from '../../store/clock'
import {
  BuiltInMcpSource,
  CompatMcpSource,
  FileMcpSource,
  resolveMcpSpecs,
  type McpRejection,
  type McpSource,
} from '../config'
import { HandleStore } from '../bridge/handle-store'
import { McpInstructionsHook } from '../instructions/instructions-hook'
import { OAuthCallbackServer } from '../oauth/callback-server'
import { McpOAuthFlow, type McpAuthResult } from '../oauth/flow'
import { McpOAuthStore } from '../oauth/token-store'

export const mcpSourcesFor = (args: { cwd: string }): readonly McpSource[] => [
  new BuiltInMcpSource(),
  FileMcpSource.user(),
  FileMcpSource.project({ cwd: args.cwd }),
  new CompatMcpSource({ cwd: args.cwd }),
]

export type RegisteredMcp = {
  store: HandleStore
  rejections: readonly McpRejection[]
  /** Drives an interactive sign-in for a server that answered 401; absent when there is no secrets store. */
  signIn: ((args: { serverUrl: string; wwwAuthenticate?: string }) => Promise<McpAuthResult>) | undefined
}

const oauthFlowFrom = (container: DependencyContainer): McpOAuthFlow | undefined => {
  if (!container.isRegistered(SecretsStoreToken, true)) return undefined
  return new McpOAuthFlow({
    store: new McpOAuthStore({ secrets: container.resolve(SecretsStoreToken) }),
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
    sources: mcpSourcesFor({ cwd: args.cwd }),
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
