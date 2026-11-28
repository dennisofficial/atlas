import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EReturnResult,
  stateOfStartLink,
  type Event,
  type RecordEvent,
  type ReturnOutcome,
} from '@dltech/atlas-core'
import { mcpSignInEntries } from '@dltech/atlas-plugin-mcp/client'
import {
  MCP_VIEW,
  mcpRosterOfEvents,
  mcpServerRowsSchema,
  type McpServerRow,
} from '@dltech/atlas-plugin-mcp/core'

import type { ListPanelRow } from '../ui/components/list-panel'
import type { LoopbackCopy } from './browser-return/loopback-page'
import { openBrowserReturn, type OpenBrowserReturn } from './browser-return/open'
import { useReturnOutcome } from './browser-return/use-return-outcome'
import type { McpOauthServer, SessionApi } from './session-api'
import { useOpenPanel, type OpenPanelControl } from './use-open-panel'

export type McpPanelApi = Pick<SessionApi, 'mcpServers' | 'mcpOauthBegin'>

export type McpPanelTarget =
  | { kind: 'begin'; serverId: string; serverName: string }
  | { kind: 'url'; url: string }

export type McpPanelSignIn = { state: string; server: string }

export type McpPanel = OpenPanelControl & {
  rows: readonly ListPanelRow[]
  handlePick: (index: number) => void
  handleKey: (key: KeyEvent) => boolean
}

export type McpPanelBody = {
  rows: readonly ListPanelRow[]
  targets: readonly (McpPanelTarget | null)[]
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const mcpRowsOfView = (
  views: Readonly<Record<string, unknown>>,
): readonly McpServerRow[] => {
  const parsed = mcpServerRowsSchema.safeParse(views[MCP_VIEW])
  return parsed.success ? parsed.data : []
}

export const mcpRosterOf = (args: {
  views: Readonly<Record<string, unknown>>
  events: readonly (Event | RecordEvent)[]
}): readonly McpServerRow[] => {
  const held = mcpRowsOfView(args.views)
  return held.length > 0 ? held : mcpRosterOfEvents(args.events)
}

export const mcpServerIdsOf = (servers: readonly McpOauthServer[]): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>()
  for (const server of [...servers].sort((left, right) => left.source.localeCompare(right.source)))
    ids.set(server.name, server.id)
  return ids
}

export const mcpSignInCopyOf = (server: string): LoopbackCopy => ({
  connected: `Signed in to ${server}`,
  failed: (reason: string | undefined) =>
    reason === undefined
      ? `Could not sign in to ${server}`
      : `Could not sign in to ${server}: ${reason}`,
})

export const mcpSignInRowOf = (args: {
  signIn: McpPanelSignIn
  outcome: ReturnOutcome | undefined
}): ListPanelRow => {
  const server = args.signIn.server
  if (args.outcome === undefined)
    return {
      key: 'sign-in:result',
      label: `signing in to ${server}`,
      detail: 'waiting for the browser',
      mark: { text: '…', tone: 'warn' },
    }
  if (args.outcome.result === EReturnResult.Connected)
    return {
      key: 'sign-in:result',
      label: `signed in to ${server}`,
      mark: { text: '●', tone: 'ok' },
    }
  return {
    key: 'sign-in:result',
    label: `could not sign in to ${server}`,
    ...(args.outcome.reason === undefined ? {} : { detail: args.outcome.reason }),
    mark: { text: '○', tone: 'warn' },
  }
}

const serverDetail = (row: McpServerRow): string => {
  const tools = `${row.toolCount} ${row.toolCount === 1 ? 'tool' : 'tools'}`
  return row.reason === undefined
    ? `${row.status}   ${tools}`
    : `${row.status}   ${tools} — ${row.reason}`
}

export const mcpPanelOf = (args: {
  servers: readonly McpServerRow[]
  signIns: ReturnType<typeof mcpSignInEntries>
  ids: ReadonlyMap<string, string>
  pending: { signIn: McpPanelSignIn; outcome: ReturnOutcome | undefined } | null
}): McpPanelBody => {
  const rows: ListPanelRow[] = []
  const targets: (McpPanelTarget | null)[] = []

  for (const server of args.servers) {
    const id = args.ids.get(server.name)
    rows.push({
      key: `server:${server.name}`,
      label: server.name,
      detail: serverDetail(server),
      mark: server.status === 'connected' ? { text: '●', tone: 'ok' } : { text: '○', tone: 'meta' },
    })
    targets.push(id === undefined ? null : { kind: 'begin', serverId: id, serverName: server.name })
  }

  for (const [key, entry] of args.signIns) {
    if (entry.result !== undefined) continue
    rows.push({
      key: `sign-in:${key}`,
      label: `sign in to ${entry.subject ?? 'the server'}`,
      detail: entry.url,
      mark: { text: 'link', tone: 'warn' },
    })
    targets.push({ kind: 'url', url: entry.url })
  }

  if (args.pending !== null) {
    rows.push(mcpSignInRowOf(args.pending))
    targets.push(null)
  }

  return { rows, targets }
}

export function useMcpPanel(args: {
  api: McpPanelApi | null
  views: Readonly<Record<string, unknown>>
  events: readonly (Event | RecordEvent)[]
  openUrl: (url: string) => void
  onProblem: (reason: string) => void
  openSignIn?: ((args: OpenBrowserReturn) => void) | undefined
}): McpPanel {
  const [ids, setIds] = useState<ReadonlyMap<string, string>>(new Map())
  const [signIn, setSignIn] = useState<McpPanelSignIn | null>(null)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem
  const { api } = args
  const open = useOpenPanel()

  const loadIds = useCallback(
    (args: { alive: () => boolean }) => {
      if (api === null) return
      void api.mcpServers().then(
        (servers) => {
          if (args.alive()) setIds(mcpServerIdsOf(servers))
        },
        () => {
          if (args.alive()) setIds(new Map())
        },
      )
    },
    [api],
  )

  useEffect(() => {
    if (!open.panel.open) return undefined
    let held = true
    loadIds({ alive: () => held })
    return () => {
      held = false
    }
  }, [loadIds, open.panel.open])

  const begin = useCallback(
    (target: { serverId: string; serverName: string }) => {
      if (api === null) return
      const openReturn = args.openSignIn ?? openBrowserReturn
      void api.mcpOauthBegin({ serverId: target.serverId }).then(
        (answer) => {
          if (answer.outcome !== 'redirect') {
            problem.current(answer.reason)
            return
          }
          openReturn({
            url: answer.authorizationUrl,
            open: args.openUrl,
            copy: mcpSignInCopyOf(target.serverName),
          })
          const state = stateOfStartLink(answer.authorizationUrl)
          if (state !== undefined) setSignIn({ state, server: target.serverName })
        },
        (failure: unknown) => problem.current(messageOf(failure)),
      )
    },
    [api, args],
  )

  const outcome = useReturnOutcome({ state: signIn?.state, durable: undefined })
  const shown = useRef<string | undefined>(undefined)
  const outcomeKey = outcome === undefined ? undefined : `${outcome.result}:${outcome.reason ?? ''}`

  useEffect(() => {
    if (signIn === null || outcomeKey === undefined) return
    const key = `${signIn.state}:${outcomeKey}`
    if (shown.current === key) return
    shown.current = key
    loadIds({ alive: () => true })
  }, [signIn, outcomeKey, loadIds])

  const body = mcpPanelOf({
    servers: mcpRosterOf(args),
    signIns: mcpSignInEntries(args.events),
    ids,
    pending: signIn === null ? null : { signIn, outcome },
  })

  const handlePick = useCallback(
    (index: number) => {
      const target = body.targets[index]
      if (target === undefined || target === null) return
      if (target.kind === 'url') {
        args.openUrl(target.url)
        return
      }
      begin({ serverId: target.serverId, serverName: target.serverName })
    },
    [args, begin, body.targets],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (!open.panel.open) return false
      if (key.name === 'escape') {
        open.handleClose()
        return true
      }
      if (open.handleMove(key, body.rows.length)) return true
      if (key.name === 'return' || key.name === 'enter') {
        handlePick(open.panel.index)
        return true
      }
      return false
    },
    [body.rows.length, handlePick, open],
  )

  return { ...open, rows: body.rows, handlePick, handleKey }
}
