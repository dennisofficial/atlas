'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { McpOauthServer } from '@dltech/atlas-wire/web'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { api, cloudCall } from '@/lib/api-client'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

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
  signIn: (serverId: string) => void
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
    (serverId: string) => {
      setBusyId(serverId)
      let redirecting = false
      void runAction({
        work: async () => {
          const desktop = isDesktopHost(window)
          const result = await beginMcpSignIn({
            serverId,
            surface: desktop ? 'desktop' : 'web',
            screen,
          })
          if (result.ok && desktop) {
            window.open(result.url, '_blank', 'noopener')
            return
          }
          if (result.ok) {
            redirecting = true
            window.location.assign(result.url)
            return
          }
          toast.info(`Sign-in isn't available for this server: ${result.reason}`)
        },
      }).finally(() => {
        if (!redirecting) setBusyId(null)
      })
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
