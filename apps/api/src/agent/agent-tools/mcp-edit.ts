import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { mcpTransportSchema, type McpTransport } from '@dltech/atlas-plugin-mcp/core'
import { z } from 'zod'

import type { CloudConfigClient, McpServerView } from '../config/cloud-config-store'
import { done, fail, foreignProject, listing, reasonOf } from './cloud-outcome'

export enum EMcpEditAction {
  List = 'list',
  Add = 'add',
  Remove = 'remove',
  Enable = 'enable',
  Disable = 'disable',
}

export const mcpEditInputSchema = z.strictObject({
  action: z.enum(EMcpEditAction),
  name: z.string().min(1).optional(),
  transport: mcpTransportSchema.optional(),
})

type Input = z.output<typeof mcpEditInputSchema>

const description = [
  'List and change the MCP servers this project’s sessions load from Atlas.',
  'action is list, add, remove, disable or enable. name is the server name; transport is stdio {command, args, env} or http {url, headers}.',
  'add writes a server with a transport; disable keeps its transport and stops it loading; enable re-enables a server that still carries a transport.',
  'Changes apply on the next sandbox start.',
].join(' ')

const keysNote = (args: { label: string; record: Record<string, string> | undefined }): string => {
  const keys = Object.keys(args.record ?? {})
  return keys.length === 0 ? '' : ` ${args.label}: ${keys.join(', ')}`
}

const transportLine = (transport: McpTransport): string => {
  if (transport.kind === 'http') {
    return `http ${transport.url}${keysNote({ label: 'headers', record: transport.headers })}`
  }
  return `stdio ${transport.command}${keysNote({ label: 'env', record: transport.env })}`
}

const rowLine = (row: McpServerView): string => {
  const base =
    row.transport === undefined
      ? `${row.name} (no transport)`
      : `${row.name} ${transportLine(row.transport)}`
  return row.disabled ? `${base} (disabled)` : base
}

const need = (args: { value: string | undefined; field: string }): string | ToolOutcome =>
  args.value === undefined ? fail(`${args.field} is required for this action`) : args.value

const isFailure = (value: string | ToolOutcome): value is ToolOutcome => typeof value !== 'string'

const APPLIES = 'It applies on the next sandbox start.'

const change = async (args: {
  client: CloudConfigClient
  input: Input
  name: string
}): Promise<ToolOutcome> => {
  const { client, input, name } = args
  if (input.action === EMcpEditAction.Remove) {
    const removed = await client.removeMcpServer(name)
    return removed
      ? done({ text: `Removed mcp server ${name}. ${APPLIES}` })
      : fail(`there is no mcp server "${name}"`)
  }
  if (input.action === EMcpEditAction.Add) {
    if (input.transport === undefined) return fail('transport is required to add a server')
    await client.putMcpServer({ name, transport: input.transport, disabled: false })
    return done({ text: `Set mcp server ${name}. ${APPLIES}` })
  }
  const existing = await client.readMcpServer(name)
  if (existing === null) return fail(`there is no mcp server "${name}"`)
  if (input.action === EMcpEditAction.Disable) {
    await client.putMcpServer({ name, transport: existing.transport, disabled: true })
    return done({ text: `Disabled mcp server ${name}. ${APPLIES}` })
  }
  if (existing.transport === undefined) {
    return fail(`mcp server "${name}" has no transport; add it with a transport to enable it`)
  }
  await client.putMcpServer({ name, transport: existing.transport, disabled: false })
  return done({ text: `Enabled mcp server ${name}. ${APPLIES}` })
}

export class McpEditTool extends SchemaTool<typeof mcpEditInputSchema> {
  readonly name = 'mcp-edit'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = mcpEditInputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly access: { client: CloudConfigClient; projectId: string }) {
    super()
  }

  protected override async run({
    input,
  }: ToolRun<typeof mcpEditInputSchema>): Promise<ToolOutcome> {
    const { client, projectId } = this.access
    const foreign = foreignProject({ own: projectId, bound: client.projectId })
    if (foreign !== undefined) return foreign
    try {
      if (input.action === EMcpEditAction.List) {
        return listing({
          title: 'mcp servers',
          lines: (await client.listMcpServers()).map(rowLine),
        })
      }
      const name = need({ value: input.name, field: 'name' })
      if (isFailure(name)) return name
      return await change({ client, input, name })
    } catch (error) {
      return fail(reasonOf(error))
    }
  }
}
