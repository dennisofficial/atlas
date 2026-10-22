import { z } from 'zod'

import {
  EMcpTransportKind,
  mcpServerSchema,
  type McpServerWire,
  type McpTransportWire,
} from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import { EMcpTransport, type McpServer } from '../../fixtures/settings-mcp'
import { splitCommandLine } from '../command-line'
import { targetOf, transportOfDraft } from '../workspace/mcp-mapping'

const listSchema = z.object({ servers: z.array(mcpServerSchema) })

export function transportOf(
  draft: Pick<McpServer, 'transport' | 'target'> & { extra?: string },
): McpTransportWire {
  const kind =
    draft.transport === EMcpTransport.Http ? EMcpTransportKind.Http : EMcpTransportKind.Stdio
  if (kind === EMcpTransportKind.Stdio && splitCommandLine(draft.target).command === '') {
    throw new Error('Enter a command to run')
  }
  return transportOfDraft({
    kind,
    target: draft.target,
    ...(draft.extra === undefined ? {} : { extra: draft.extra }),
  })
}

export function toMcpServer(wire: McpServerWire): McpServer {
  return {
    id: wire.name,
    transport:
      wire.transport?.kind === EMcpTransportKind.Http ? EMcpTransport.Http : EMcpTransport.Stdio,
    target: targetOf(wire.transport),
    enabled: wire.disabled !== true,
  }
}

export async function fetchMcpServers(): Promise<McpServerWire[]> {
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: '/v1/mcp-servers',
    schema: listSchema,
  })
  return body.servers
}

export function putMcpServer(args: {
  name: string
  transport?: McpTransportWire | undefined
  disabled?: boolean | undefined
}): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Put,
    path: `/v1/mcp-servers/${encodeURIComponent(args.name)}`,
    body: {
      ...(args.transport === undefined ? {} : { transport: args.transport }),
      ...(args.disabled === undefined ? {} : { disabled: args.disabled }),
    },
  })
}

export function addMcpServer(
  draft: Parameters<typeof transportOf>[0] & { id: string },
): Promise<void> {
  return putMcpServer({ name: draft.id, transport: transportOf(draft), disabled: false })
}

export function deleteMcpServer(name: string): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Delete,
    path: `/v1/mcp-servers/${encodeURIComponent(name)}`,
  })
}
