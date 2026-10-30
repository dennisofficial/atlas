import {
  EMcpTransportKind,
  type McpServerWire,
  type McpTransportWire,
  type McpUpsertWire,
} from '@dltech/atlas-wire/web'

import { signInUrlOf } from './mcp-oauth'
import { joinCommandLine, parseKeyValueLines, splitCommandLine } from '../command-line'

export type McpRow = {
  id: string
  kind: EMcpTransportKind
  target: string
  enabled: boolean
  signInUrl?: string
}

export type McpRowDraft = {
  kind: EMcpTransportKind
  target: string
  extra?: string
  enabled?: boolean
}

export const transportKindOf = (value: string): EMcpTransportKind =>
  value === EMcpTransportKind.Http ? EMcpTransportKind.Http : EMcpTransportKind.Stdio

export function targetOf(transport: McpTransportWire | undefined): string {
  if (transport === undefined) return ''
  if (transport.kind === EMcpTransportKind.Http) return transport.url
  return joinCommandLine({ command: transport.command, args: transport.args ?? [] })
}

export function signInFieldOf(transport: McpTransportWire | undefined): { signInUrl?: string } {
  if (transport?.kind !== EMcpTransportKind.Http) return {}
  const url = signInUrlOf({ url: transport.url, headers: transport.headers })
  return url === undefined ? {} : { signInUrl: url }
}

export function rowOfServer(server: McpServerWire): McpRow {
  return {
    id: server.name,
    kind: server.transport?.kind ?? EMcpTransportKind.Stdio,
    target: targetOf(server.transport),
    enabled: server.disabled !== true,
    ...signInFieldOf(server.transport),
  }
}

export function transportOfDraft(draft: McpRowDraft): McpTransportWire {
  const extra = draft.extra ?? ''
  if (draft.kind === EMcpTransportKind.Http) {
    const headers = parseKeyValueLines({ text: extra, separator: ':' })
    return {
      kind: EMcpTransportKind.Http,
      url: draft.target.trim(),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    }
  }
  const { command, args } = splitCommandLine(draft.target)
  const env = parseKeyValueLines({ text: extra, separator: '=' })
  return {
    kind: EMcpTransportKind.Stdio,
    command,
    ...(args.length === 0 ? {} : { args }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
  }
}

export const upsertOfDraft = (draft: McpRowDraft): McpUpsertWire => ({
  transport: transportOfDraft(draft),
  ...(draft.enabled === false ? { disabled: true } : {}),
})

export const upsertOfToggle = ({
  server,
  enabled,
}: {
  server: McpServerWire
  enabled: boolean
}): McpUpsertWire => ({
  ...(server.transport === undefined ? {} : { transport: server.transport }),
  disabled: !enabled,
})
