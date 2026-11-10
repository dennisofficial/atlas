'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { McpOauthServer } from '@dltech/atlas-wire/web'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { fetchStreamToken } from '@/features/sessions/data/stream-token'
import { api, cloudCall } from '@/lib/api-client'
import { hostOrigin } from '@/lib/host-url'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { beginMcpSignIn } from './mcp-signin-request'
import { authStateOf, cloudServerOf, repoServersOf, EMcpAuthState } from './mcp-oauth'
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

async function loadServers(projectId: string | undefined): Promise<LoadedServers> {
  const result = await cloudCall(
    api.mcpOauth.servers.query(projectId === undefined ? {} : { projectId }),
  )
  return { servers: result.servers, now: Date.now() }
}

export function useMcpOauth({ projectId }: { projectId?: string } = {}): McpOauth {
  const query = useCloudQuery({
    key: `mcp-oauth:${projectId ?? 'personal'}`,
    load: () => loadServers(projectId),
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
          const result = await beginMcpSignIn({
            hostOrigin: hostOrigin(),
            token: await fetchStreamToken(),
            serverId,
            surface: isDesktopHost(window) ? 'desktop' : 'web',
            screen:
              projectId === undefined
                ? { kind: 'settings', scope: 'user' }
                : { kind: 'settings', scope: 'project', id: projectId },
          })
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
    [projectId],
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
