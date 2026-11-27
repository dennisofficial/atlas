'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { stateOfStartLink } from '@dltech/atlas-core'
import type { McpOauthServer } from '@dltech/atlas-wire/web'

import { openBrowserReturn } from '@/features/auth/browser-return'
import { api, cloudCall } from '@/lib/api-client'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { rememberMcpSignIn } from './mcp-signin-attempts'
import { beginMcpSignIn, type McpSignInScreen } from './mcp-signin-request'
import {
  authStateOf,
  cloudServerOf,
  repoServersOf,
  EMcpAuthState,
  mcpOauthScreenOf,
  mcpOauthServersInputOf,
  type McpOauthScope,
} from './mcp-oauth'
import { runAction } from './run-action'

export type McpOauth = {
  cloudServer: (name: string) => McpOauthServer | undefined
  repoServers: McpOauthServer[]
  stateOf: (server: McpOauthServer | undefined) => EMcpAuthState
  isBusy: (serverId: string) => boolean
  signIn: (args: { serverId: string; label: string }) => void
  signOut: (serverId: string) => void
  forget: (serverId: string) => Promise<boolean>
  now: number
  reload: () => void
}

type LoadedServers = { servers: McpOauthServer[]; now: number }

const EMPTY: LoadedServers = { servers: [], now: 0 }

type ScopedRequest = {
  key: string
  input: { projectId?: string; groupId?: string }
  screen: McpSignInScreen
}

const scopeIdOf = (scope: McpOauthScope): string =>
  scope.kind === 'project' ? scope.projectId : scope.kind === 'group' ? scope.groupId : 'personal'

async function loadServers(input: ScopedRequest['input']): Promise<LoadedServers> {
  const result = await cloudCall(api.mcpOauth.servers.query(input))
  return { servers: result.servers, now: Date.now() }
}

export function useMcpOauth(scope: McpOauthScope = { kind: 'user' }): McpOauth {
  const kind = scope.kind
  const id = scopeIdOf(scope)
  const { key, input, screen } = useMemo<ScopedRequest>(
    () => ({
      key: `${kind}:${id}`,
      input: mcpOauthServersInputOf(scope),
      screen: mcpOauthScreenOf(scope),
    }),
    [kind, id],
  )
  const query = useCloudQuery({
    key: `mcp-oauth:${key}`,
    load: () => loadServers(input),
  })
  const { reload } = query
  const [busyId, setBusyId] = useState<string | null>(null)
  const { servers, now } = query.state === EQueryState.Ready ? query.data : EMPTY
  const failed = query.state === EQueryState.Failed

  useEffect(() => {
    if (failed) toast.error("Couldn't check MCP sign-in status")
  }, [failed])

  const signIn = useCallback(
    (args: { serverId: string; label: string }) => {
      setBusyId(args.serverId)
      void runAction({
        work: async () => {
          const result = await beginMcpSignIn({ serverId: args.serverId, screen })
          if (!result.ok) {
            toast.info(`Sign-in isn't available for this server: ${result.reason}`)
            return
          }
          const state = stateOfStartLink(result.url)
          if (state !== undefined) rememberMcpSignIn({ state, label: args.label })
          openBrowserReturn({ url: result.url })
        },
      }).finally(() => setBusyId(null))
    },
    [screen],
  )

  const signOut = useCallback(
    (serverId: string) =>
      void runAction({
        work: async () => {
          await cloudCall(api.mcpOauth.disconnect.mutate({ serverId }))
          reload()
        },
        success: 'Signed out',
      }),
    [reload],
  )

  const forget = useCallback(
    (serverId: string) =>
      runAction({
        work: async () => {
          await cloudCall(api.mcpOauth.forget.mutate({ serverId }))
          reload()
        },
      }),
    [reload],
  )

  return {
    cloudServer: (name) => cloudServerOf(servers, name),
    repoServers: repoServersOf(servers),
    stateOf: (server) => (failed ? EMcpAuthState.SignIn : authStateOf(server)),
    isBusy: (serverId) => busyId === serverId,
    signIn,
    signOut,
    forget,
    now,
    reload,
  }
}
