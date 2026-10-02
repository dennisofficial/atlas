import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import type { DependencyContainer } from '../container/injection'
import { EMcpAuthOutcome } from '../mcp/oauth/flow'
import type { McpServerStatus } from '../mcp/registry/handle-status'
import { registerMcp, type RegisteredMcp } from '../mcp/registry/register-mcp'

import { mcpBootNotice, mcpRejectionNotice } from './mcp-report'

export type McpSignInResult = { ok: boolean; detail: string }

export type McpSignIn = (args: { serverName: string }) => Promise<McpSignInResult>

export type McpBinding = {
  servers: () => readonly McpServerStatus[]
  signIn: McpSignIn | undefined
}

const announce = (args: { mcp: RegisteredMcp; notice: NoticePort }): void => {
  for (const server of args.mcp.store.servers()) {
    const bootNotice = mcpBootNotice(server)
    if (bootNotice === null) continue
    args.notice.notify({
      key: `mcp:${server.spec.name}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: bootNotice,
    })
  }

  for (const rejection of args.mcp.rejections) {
    args.notice.notify({
      key: `mcp:rejection:${rejection.definedIn}:${rejection.name ?? 'file'}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: mcpRejectionNotice(rejection),
    })
  }
}

const signInFor = (mcp: RegisteredMcp): McpSignIn | undefined => {
  const authenticate = mcp.signIn
  if (authenticate === undefined) return undefined

  return async ({ serverName }) => {
    const status = mcp.store.servers().find((server) => server.spec.name === serverName)
    if (status === undefined) return { ok: false, detail: `no MCP server named '${serverName}' is configured` }
    if (status.spec.transport?.kind !== 'http')
      return { ok: false, detail: `'${serverName}' is not an HTTP server, so it has no OAuth sign-in` }

    const challenge = mcp.store.challengeOf({ serverId: serverName })
    const result = await authenticate({
      serverUrl: status.spec.transport.url,
      ...(challenge === undefined ? {} : { wwwAuthenticate: challenge }),
    })

    if (result.outcome === EMcpAuthOutcome.NeedsClientRegistration)
      return { ok: false, detail: `'${serverName}' does not support OAuth sign-in: ${result.reason}` }

    await mcp.store.reconnect({ serverId: serverName })
    const verb = result.outcome === EMcpAuthOutcome.Refreshed ? 'refreshed the token for' : 'signed in to'
    return { ok: true, detail: `${verb} '${serverName}'` }
  }
}

export async function bindMcp(args: {
  container: DependencyContainer
  cwd: string
  notice: NoticePort
}): Promise<McpBinding> {
  const mcp = await registerMcp({ container: args.container, cwd: args.cwd })
  announce({ mcp, notice: args.notice })

  return { servers: () => mcp.store.servers(), signIn: signInFor(mcp) }
}
