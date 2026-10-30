import { BeforeTurnHook, DynamicToolSource } from '@dltech/atlas-core'

import { createUrlOpener } from '../../browser/open-url'
import { registerDisposable } from '../../container/disposal'
import { portToken, type DependencyContainer } from '../../container/injection'
import { ClientVersionToken, SecretsStoreToken, ServeSessionToken } from '../../container/tokens'
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
import { tokenSourceOfFlow, type McpTokenSource } from '../bridge/token-source'
import { CloudMcpTokenSource } from '../cloud/cloud-mcp-token-source'
import { mcpOauthAccessCall } from '../cloud/mcp-oauth-client'
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
  /** Settles once every server has finished connecting or failing; never rejects. */
  connected: Promise<void>
  /** Drives an interactive sign-in for a server that answered 401; absent when there is no secrets store. */
  signIn:
    | ((args: { serverUrl: string; wwwAuthenticate?: string }) => Promise<McpAuthResult>)
    | undefined
  refresh: () => Promise<void>
}

export const MCP_REFRESH_BUDGET_MS = 5_000

const cloudTokenSourceFrom = (container: DependencyContainer): McpTokenSource | undefined => {
  if (!container.isRegistered(ServeSessionToken, true)) return undefined
  const clientVersion = container.isRegistered(ClientVersionToken, true)
    ? container.resolve(ClientVersionToken)
    : 'dev'
  return new CloudMcpTokenSource({
    access: mcpOauthAccessCall({ session: container.resolve(ServeSessionToken), clientVersion }),
  })
}

const oauthFlowFrom = (container: DependencyContainer): McpOAuthFlow | undefined => {
  if (container.isRegistered(ServeSessionToken, true)) return undefined
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
  refreshBudgetMs?: number
}): Promise<RegisteredMcp> {
  const resolved = await resolveMcpSpecs({
    sources: mcpSourcesFor({ cwd: args.cwd }),
  })

  const flow = oauthFlowFrom(args.container)
  const tokenSource =
    cloudTokenSourceFrom(args.container) ??
    (flow === undefined ? undefined : tokenSourceOfFlow(flow))
  const store = new HandleStore({
    specs: resolved.specs,
    ...(tokenSource === undefined ? {} : { tokenSource }),
  })
  const connected = store.connectAll()

  args.container.register(portToken(DynamicToolSource), { useValue: store })
  args.container.register(portToken(BeforeTurnHook), {
    useValue: new McpInstructionsHook({ store }),
  })
  registerDisposable({ container: args.container, close: () => store.closeAll() })

  const signIn =
    flow === undefined
      ? undefined
      : (signInArgs: { serverUrl: string; wwwAuthenticate?: string }) => flow.signIn(signInArgs)

  const reconcileAndRetry = async (): Promise<void> => {
    const latest = await resolveMcpSpecs({ sources: mcpSourcesFor({ cwd: args.cwd }) })
    await store.reconcile({ specs: latest.specs })
    await store.retryNeedsAuth()
  }
  let inFlight: Promise<void> | undefined
  const refresh = (): Promise<void> => {
    inFlight ??= reconcileAndRetry()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined
      })
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, args.refreshBudgetMs ?? MCP_REFRESH_BUDGET_MS)
      timer.unref?.()
    })
    return Promise.race([inFlight, budget]).finally(() => clearTimeout(timer))
  }

  return { store, rejections: resolved.rejections, signIn, connected, refresh }
}
