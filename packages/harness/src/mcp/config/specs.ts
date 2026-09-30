import { z } from 'zod'

export const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const nameSchema = z
  .string()
  .min(1, 'a server name cannot be empty')
  .regex(
    MCP_NAME_PATTERN,
    'a server name holds only letters, digits, underscores and hyphens, because the model reads it verbatim in tool names',
  )

const stdioTransportSchema = z.strictObject({
  kind: z.literal('stdio'),
  command: z.string().min(1, 'a stdio server needs a command to spawn'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const httpTransportSchema = z.strictObject({
  kind: z.literal('http'),
  url: z.url({ protocol: /^https?$/, error: 'an http server url must start with http:// or https://' }),
  headers: z.record(z.string(), z.string()).optional(),
})

export const mcpTransportSchema = z.discriminatedUnion('kind', [
  stdioTransportSchema,
  httpTransportSchema,
])

export type McpTransport = z.infer<typeof mcpTransportSchema>

export const mcpSpecSchema = z
  .strictObject({
    name: nameSchema,
    transport: mcpTransportSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .check((ctx) => {
    if (ctx.value.disabled === true || ctx.value.transport !== undefined) return
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      path: ['transport'],
      message: 'a server that is not disabled needs a transport',
    })
  })

export type ParsedMcpSpec = z.infer<typeof mcpSpecSchema>

const mcpServersFieldSchema = z.record(z.string(), z.unknown())

export const MCP_SERVERS_FIELD = 'mcpServers'

export const MCP_TRANSPORT_FIELD = 'transport'

const wrappedFieldSchema = z.strictObject({ [MCP_SERVERS_FIELD]: mcpServersFieldSchema })

export const mcpConfigFileSchema = z.union([mcpServersFieldSchema, wrappedFieldSchema])

export type McpConfigFile = z.infer<typeof mcpConfigFileSchema>

export const mcpServersOf = (file: McpConfigFile): Readonly<Record<string, unknown>> => {
  const wrapped = wrappedFieldSchema.safeParse(file)
  return wrapped.success ? wrapped.data[MCP_SERVERS_FIELD] : file
}

// Claude Code's .mcp.json spells a server `{ type, command, args, env, url, headers }` at the
// top level; Atlas spells it `{ transport: { kind, ... } }`. The compat source translates before
// validating so a real-world .mcp.json parses instead of rejecting every entry.
// https://code.claude.com/docs/en/mcp#configure-mcp-servers
const COMPAT_TYPE_FIELD = 'type'

const compatEntryToNative = (entry: Record<string, unknown>): Record<string, unknown> => {
  if (entry[MCP_TRANSPORT_FIELD] !== undefined) return entry

  const { [COMPAT_TYPE_FIELD]: type, command, args, env, url, headers, ...rest } = entry
  const kind = typeof type === 'string' ? type : command !== undefined ? 'stdio' : url !== undefined ? 'http' : undefined

  if (kind === 'stdio') {
    return { ...rest, [MCP_TRANSPORT_FIELD]: { kind, command, ...(args !== undefined ? { args } : {}), ...(env !== undefined ? { env } : {}) } }
  }
  if (kind === 'http') {
    return { ...rest, [MCP_TRANSPORT_FIELD]: { kind, url, ...(headers !== undefined ? { headers } : {}) } }
  }
  return entry
}

export const compatMcpEntryToNative = (entry: unknown): unknown => {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
  return compatEntryToNative(entry as Record<string, unknown>)
}
