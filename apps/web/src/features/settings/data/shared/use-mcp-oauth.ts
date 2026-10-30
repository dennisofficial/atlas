'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { EMcpOauthBeginOutcome, type McpOauthGrant } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { authStateOf, statusUrlsOf, EMcpAuthState, type McpOauthSubject } from './mcp-oauth'
import { runAction } from './run-action'

export type McpOauth = {
  stateOf: (signInUrl: string | undefined) => EMcpAuthState | undefined
  isBusy: (signInUrl: string) => boolean
  signIn: (signInUrl: string) => void
  signOut: (signInUrl: string) => void
  reload: () => void
}

const NO_GRANTS: McpOauthGrant[] = []

async function loadGrants(serverUrls: string[]): Promise<McpOauthGrant[]> {
  if (serverUrls.length === 0) return NO_GRANTS
  const result = await cloudCall(api.mcpOauth.status.query({ serverUrls }))
  return result.grants
}

export function useMcpOauth(servers: readonly McpOauthSubject[]): McpOauth {
  const urls = statusUrlsOf(servers)
  const query = useCloudQuery({
    key: `mcp-oauth:${urls.join('|')}`,
    load: () => loadGrants(urls),
  })
  const { reload } = query
  const [busyUrl, setBusyUrl] = useState<string | null>(null)
  const grants = query.state === EQueryState.Ready ? query.data : NO_GRANTS
  const failed = query.state === EQueryState.Failed

  useEffect(() => {
    if (failed) toast.error("Couldn't check MCP sign-in status")
  }, [failed, urls.join('|')])

  const signIn = useCallback((signInUrl: string) => {
    setBusyUrl(signInUrl)
    let redirecting = false
    void runAction({
      work: async () => {
        const result = await cloudCall(
          api.mcpOauth.begin.mutate({
            serverUrl: signInUrl,
            returnTo: window.location.pathname,
          }),
        )
        if (result.outcome === EMcpOauthBeginOutcome.Redirect) {
          redirecting = true
          window.location.assign(result.authorizationUrl)
          return
        }
        toast.info(`Sign-in isn't available for this server: ${result.reason}`)
      },
    }).finally(() => {
      if (!redirecting) setBusyUrl(null)
    })
  }, [])

  const signOut = useCallback(
    (signInUrl: string) =>
      void runAction({
        work: async () => {
          await cloudCall(api.mcpOauth.disconnect.mutate({ serverUrl: signInUrl }))
          reload()
        },
        success: 'Signed out',
      }),
    [reload],
  )

  return {
    stateOf: (signInUrl) =>
      failed && signInUrl !== undefined && urls.includes(signInUrl)
        ? EMcpAuthState.SignIn
        : authStateOf({ signInUrl, grants }),
    isBusy: (signInUrl) => busyUrl === signInUrl,
    signIn,
    signOut,
    reload,
  }
}
