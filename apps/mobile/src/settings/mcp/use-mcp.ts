import type { ApiClient } from '@dltech/atlas-api-router'
import { stateOfStartLink } from '@dltech/atlas-core'
import {
  type McpResultMessage,
  type McpRow,
  type McpScope,
  type McpServerDraft,
  EMcpAuthState,
  authStateOf,
  cloudServerOf,
  lastUsedOf,
  mcpOauthScreenOfScope,
  mcpResultMessageOf,
  mcpServerPutInputOf,
  mcpServersInputOf,
  repoServersOf,
  rowOfServer,
  upsertOfToggle,
} from '@dltech/atlas-client/settings'
import {
  EMcpOauthBeginOutcome,
  type McpOauthServer,
  type McpServerLayer,
  type McpServerWire,
} from '@dltech/atlas-wire/web'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'

import { openBrowserReturn, useReturnOutcome } from '../../browser-return'
import { EResourceState } from '../api-resource-state'
import { useApiResource } from '../use-api-resource'

type LoadedMcp = {
  servers: readonly McpServerWire[]
  oauth: readonly McpOauthServer[]
  now: number
}

type SignInAttempt = { state: string | undefined; label: string }

export type McpControls = {
  state: EResourceState
  rows: readonly McpRow[]
  repoServers: readonly McpOauthServer[]
  notice: McpResultMessage | undefined
  busyId: string | null
  reload: () => void
  add: (draft: McpServerDraft) => Promise<void>
  toggle: (args: { id: string; enabled: boolean }) => Promise<void>
  remove: (id: string) => Promise<void>
  signIn: (args: { serverId: string; label: string }) => void
  signOut: (serverId: string) => Promise<void>
  forget: (serverId: string) => Promise<void>
  authStateOf: (server: McpOauthServer | undefined) => EMcpAuthState
  cloudServerOf: (name: string) => McpOauthServer | undefined
  lastUsedOf: (server: McpOauthServer) => string | undefined
}

const EMPTY: LoadedMcp = { servers: [], oauth: [], now: 0 }

const apiOf = (api: ApiClient | undefined): ApiClient => {
  if (api === undefined) throw new Error('Not signed in')
  return api
}

const oauthInputOf = (scope: McpScope): { projectId?: string; groupId?: string } => {
  if (scope.kind === 'project') return { projectId: scope.id }
  if (scope.kind === 'group') return { groupId: scope.id }
  return {}
}

const scopeKeyOf = (scope: McpScope): string => (scope.kind === 'user' ? 'user' : scope.id)

export const useMcp = ({
  api,
  scope,
}: {
  api: ApiClient | undefined
  scope: McpScope
}): McpControls => {
  const scopeKey = scopeKeyOf(scope)
  const { state, data, reload } = useApiResource<LoadedMcp>({
    load: async () => {
      const client = apiOf(api)
      const [list, oauth] = await Promise.all([
        client.mcpServers.list.query(mcpServersInputOf(scope)),
        client.mcpOauth.servers.query(oauthInputOf(scope)),
      ])
      return { servers: list.servers, oauth: oauth.servers, now: Date.now() }
    },
    deps: [api, scope.kind, scopeKey],
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<SignInAttempt>({ state: undefined, label: '' })
  const [notice, setNotice] = useState<McpResultMessage>()
  const outcome = useReturnOutcome({ state: attempt.state, durable: undefined })
  const shown = useRef<string | undefined>(undefined)
  const outcomeKey =
    outcome === undefined ? undefined : `${attempt.state}:${outcome.result}:${outcome.reason ?? ''}`

  useEffect(() => {
    if (outcomeKey === undefined || outcome === undefined || shown.current === outcomeKey) return
    shown.current = outcomeKey
    setNotice(mcpResultMessageOf({ label: attempt.label, outcome }))
    reload()
  }, [attempt.label, outcome, outcomeKey, reload])

  const loaded = data ?? EMPTY

  const focusedOnce = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) reload()
      focusedOnce.current = true
    }, [reload]),
  )

  const add = useCallback(
    async (draft: McpServerDraft) => {
      await apiOf(api).mcpServers.put.mutate(mcpServerPutInputOf({ scope, draft }))
      reload()
    },
    [api, scope.kind, scopeKey, reload],
  )

  const toggle = useCallback(
    async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const server = loaded.servers.find((entry) => entry.name === id)
      if (server === undefined) throw new Error(`${id} no longer exists`)
      await apiOf(api).mcpServers.put.mutate({
        ...mcpServersInputOf(scope),
        name: id,
        ...upsertOfToggle({ server, enabled }),
      })
      reload()
    },
    [api, scope.kind, scopeKey, loaded.servers, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await apiOf(api).mcpServers.remove.mutate({ ...mcpServersInputOf(scope), name: id })
      reload()
    },
    [api, scope.kind, scopeKey, reload],
  )

  const signIn = useCallback(
    ({ serverId, label }: { serverId: string; label: string }) => {
      setBusyId(serverId)
      setNotice(undefined)
      void (async () => {
        try {
          const answer = await apiOf(api).mcpOauth.begin.mutate({
            serverId,
            screen: mcpOauthScreenOfScope(scope),
          })
          if (answer.outcome !== EMcpOauthBeginOutcome.Redirect) {
            setNotice({ ok: false, message: `Sign-in isn't available: ${answer.reason}` })
            return
          }
          setAttempt({ state: stateOfStartLink(answer.authorizationUrl), label })
          await openBrowserReturn({ url: answer.authorizationUrl })
        } catch {
          setNotice({ ok: false, message: 'The sign-in could not start.' })
        } finally {
          setBusyId(null)
        }
      })()
    },
    [api, scope.kind, scopeKey, reload],
  )

  const signOut = useCallback(
    async (serverId: string) => {
      await apiOf(api).mcpOauth.disconnect.mutate({ serverId })
      reload()
    },
    [api, reload],
  )

  const forget = useCallback(
    async (serverId: string) => {
      await apiOf(api).mcpOauth.forget.mutate({ serverId })
      reload()
    },
    [api, reload],
  )

  return {
    state,
    rows: loaded.servers.map(rowOfServer),
    repoServers: repoServersOf(loaded.oauth),
    notice,
    busyId,
    reload,
    add,
    toggle,
    remove,
    signIn,
    signOut,
    forget,
    authStateOf,
    cloudServerOf: (name) => cloudServerOf(loaded.oauth, name),
    lastUsedOf: (server) => lastUsedOf({ lastSeenAt: server.lastSeenAt, now: loaded.now }),
  }
}

export const useMcpLayers = ({
  api,
  scope,
}: {
  api: ApiClient | undefined
  scope: McpScope
}): { state: EResourceState; layers: readonly McpServerLayer[] } => {
  const scopeKey = scopeKeyOf(scope)
  const { state, data } = useApiResource<McpServerLayer[]>({
    load: async () => {
      const layers = await apiOf(api).mcpServers.layered.query(mcpServersInputOf(scope))
      return layers.layers
    },
    deps: [api, scope.kind, scopeKey],
  })
  return { state, layers: data ?? [] }
}
