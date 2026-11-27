import {
  EMcpTransportKind,
  type McpServerWire,
  type McpTransportWire,
  type McpUpsertWire,
} from '@dltech/atlas-wire/web'

import { joinCommandLine, parseKeyValueLines, splitCommandLine } from './command-line'

export type McpRow = {
  id: string
  kind: EMcpTransportKind
  target: string
  enabled: boolean
  proxy?: boolean | undefined
}

export type McpRowDraft = {
  kind: EMcpTransportKind
  target: string
  extra?: string
  enabled?: boolean
  proxy?: boolean | undefined
}

export type McpServerDraft = {
  id: string
  kind: EMcpTransportKind
  target: string
  extra: string
  proxy: boolean
}

export const MCP_SERVER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export const serverIdIsValid = (id: string): boolean => MCP_SERVER_ID_PATTERN.test(id)

export const serverIdOf = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const mcpDraftIsValid = (draft: McpServerDraft): boolean =>
  serverIdIsValid(draft.id) && draft.target.trim() !== ''

export const transportKindOf = (value: string): EMcpTransportKind =>
  value === EMcpTransportKind.Http ? EMcpTransportKind.Http : EMcpTransportKind.Stdio

export function targetOf(transport: McpTransportWire | undefined): string {
  if (transport === undefined) return ''
  if (transport.kind === EMcpTransportKind.Http) return transport.url
  return joinCommandLine({
    command: transport.command,
    args: transport.args ?? [],
  })
}

export function rowOfServer(server: McpServerWire): McpRow {
  return {
    id: server.name,
    kind: server.transport?.kind ?? EMcpTransportKind.Stdio,
    target: targetOf(server.transport),
    enabled: server.disabled !== true,
    proxy: server.proxy === true,
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
  ...(draft.proxy === true ? { proxy: true } : {}),
})

export const upsertOfServerDraft = (draft: McpServerDraft): McpUpsertWire =>
  upsertOfDraft({
    kind: draft.kind,
    target: draft.target,
    extra: draft.extra,
    enabled: true,
    proxy: draft.proxy,
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
  ...(server.proxy === true ? { proxy: true } : {}),
})
