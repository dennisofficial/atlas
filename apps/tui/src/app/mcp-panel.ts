import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Event, V2Event } from '@dltech/atlas-core'
import { mcpSignInEntries } from '@dltech/atlas-plugin-mcp/client'
import {
  MCP_VIEW,
  mcpRosterOfEvents,
  mcpServerRowsSchema,
  type McpServerRow,
} from '@dltech/atlas-plugin-mcp/core'

import type { ListPanelRow } from '../ui/components/list-panel'
import type { McpOauthServer, SessionApi } from './session-api'
import { useOpenPanel, type OpenPanelControl } from './use-open-panel'

export type McpPanelTarget = { kind: 'begin'; serverId: string } | { kind: 'url'; url: string }

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
  events: readonly (Event | V2Event)[]
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

const serverDetail = (row: McpServerRow): string => {
  const tools = `${row.toolCount} ${row.toolCount === 1 ? 'tool' : 'tools'}`
  return row.reason === undefined
    ? `${row.status} · ${tools}`
    : `${row.status} · ${tools} — ${row.reason}`
}

export const mcpPanelOf = (args: {
  servers: readonly McpServerRow[]
  signIns: ReturnType<typeof mcpSignInEntries>
  ids: ReadonlyMap<string, string>
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
    targets.push(id === undefined ? null : { kind: 'begin', serverId: id })
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

  return { rows, targets }
}

export function useMcpPanel(args: {
  api: SessionApi | null
  views: Readonly<Record<string, unknown>>
  events: readonly (Event | V2Event)[]
  openUrl: (url: string) => void
  onProblem: (reason: string) => void
}): McpPanel {
  const [ids, setIds] = useState<ReadonlyMap<string, string>>(new Map())
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem
  const { api } = args
  const open = useOpenPanel()

  useEffect(() => {
    if (api === null || !open.panel.open) return undefined

    let held = true
    void api.mcpServers().then(
      (servers) => {
        if (held) setIds(mcpServerIdsOf(servers))
      },
      () => {
        if (held) setIds(new Map())
      },
    )

    return () => {
      held = false
    }
  }, [api, open.panel.open])

  const body = mcpPanelOf({
    servers: mcpRosterOf(args),
    signIns: mcpSignInEntries(args.events),
    ids,
  })

  const begin = useCallback(
    (serverId: string) => {
      if (api === null) return
      void api.mcpOauthBegin({ serverId }).then(
        (answer) => {
          if (answer.outcome === 'redirect') {
            args.openUrl(answer.authorizationUrl)
            return
          }
          problem.current(answer.reason)
        },
        (failure: unknown) => problem.current(messageOf(failure)),
      )
    },
    [api, args],
  )

  const handlePick = useCallback(
    (index: number) => {
      const target = body.targets[index]
      if (target === undefined || target === null) return
      if (target.kind === 'url') {
        args.openUrl(target.url)
        return
      }
      begin(target.serverId)
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
