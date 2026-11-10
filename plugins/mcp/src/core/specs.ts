import { EDefinitionOrigin } from '@dltech/atlas-core'
import { z } from 'zod'

export const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export const MCP_SERVERS_FIELD = 'mcpServers'

export const MCP_TRANSPORT_FIELD = 'transport'

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
  url: z.url({
    protocol: /^https?$/,
    error: 'an http server url must start with http:// or https://',
  }),
  headers: z.record(z.string(), z.string()).optional(),
})

export const mcpTransportSchema = z.discriminatedUnion('kind', [
  stdioTransportSchema,
  httpTransportSchema,
])

export type McpTransport = z.infer<typeof mcpTransportSchema>

export type McpStdioTransport = Extract<McpTransport, { kind: 'stdio' }>

export type McpHttpTransport = Extract<McpTransport, { kind: 'http' }>

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
      path: [MCP_TRANSPORT_FIELD],
      message: 'a server that is not disabled needs a transport',
    })
  })

export type McpEntry = z.infer<typeof mcpSpecSchema>

export enum EMcpRejection {
  Unreadable = 'unreadable',
  NotJson = 'not-json',
  BadShape = 'bad-shape',
  BadEntry = 'bad-entry',
  BadName = 'bad-name',
}

export type McpRejection = {
  rejection: EMcpRejection
  name: string | undefined
  definedIn: string
  origin: EDefinitionOrigin
  detail: string
}

export type LoadedMcpEntry = McpEntry & {
  origin: EDefinitionOrigin
  definedIn: string
  source: 'cloud' | 'repo'
  accessToken?: string
}

export type McpSourceRead = {
  entries: readonly LoadedMcpEntry[]
  rejections: readonly McpRejection[]
}

export const emptySourceRead = (): McpSourceRead => ({ entries: [], rejections: [] })

const MAX_REPORTED_ISSUES = 5

export const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const formatIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field === '' ? issue.message : `${field}: ${issue.message}`
    })
    .join('; ')

const nameIsValid = (name: string): boolean => mcpSpecSchema.shape.name.safeParse(name).success

export const readMcpEntries = (args: {
  servers: Readonly<Record<string, unknown>>
  definedIn: string
  origin: EDefinitionOrigin
  toNative?: (entry: unknown) => unknown
}): McpSourceRead => {
  const entries: LoadedMcpEntry[] = []
  const rejections: McpRejection[] = []

  for (const [name, rawEntry] of Object.entries(args.servers)) {
    const translated = args.toNative === undefined ? rawEntry : args.toNative(rawEntry)
    const fields = typeof translated === 'object' && translated !== null ? translated : {}
    const parsed = mcpSpecSchema.safeParse({ ...fields, name })

    if (parsed.success) {
      entries.push({
        ...parsed.data,
        origin: args.origin,
        definedIn: args.definedIn,
        source: 'repo',
      })
      continue
    }

    rejections.push({
      rejection: nameIsValid(name) ? EMcpRejection.BadEntry : EMcpRejection.BadName,
      name,
      definedIn: args.definedIn,
      origin: args.origin,
      detail: formatIssues(parsed.error.issues),
    })
  }

  return { entries, rejections }
}

const mcpServersFieldSchema = z.record(z.string(), z.unknown())

const wrappedFieldSchema = z.strictObject({ [MCP_SERVERS_FIELD]: mcpServersFieldSchema })

export const mcpConfigFileSchema = z.union([mcpServersFieldSchema, wrappedFieldSchema])

export type McpConfigFile = z.infer<typeof mcpConfigFileSchema>

export const mcpServersOf = (file: McpConfigFile): Readonly<Record<string, unknown>> => {
  const wrapped = wrappedFieldSchema.safeParse(file)
  return wrapped.success ? wrapped.data[MCP_SERVERS_FIELD] : file
}

const COMPAT_TYPE_FIELD = 'type'

const compatEntryToNative = (entry: Record<string, unknown>): Record<string, unknown> => {
  if (entry[MCP_TRANSPORT_FIELD] !== undefined) return entry

  const { [COMPAT_TYPE_FIELD]: type, command, args, env, url, headers, ...rest } = entry
  const kind =
    typeof type === 'string'
      ? type
      : command !== undefined
        ? 'stdio'
        : url !== undefined
          ? 'http'
          : undefined

  if (kind === 'stdio') {
    return {
      ...rest,
      [MCP_TRANSPORT_FIELD]: {
        kind,
        command,
        ...(args !== undefined ? { args } : {}),
        ...(env !== undefined ? { env } : {}),
      },
    }
  }
  if (kind === 'http') {
    return {
      ...rest,
      [MCP_TRANSPORT_FIELD]: { kind, url, ...(headers !== undefined ? { headers } : {}) },
    }
  }
  return entry
}

export const compatMcpEntryToNative = (entry: unknown): unknown => {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
  return compatEntryToNative(entry as Record<string, unknown>)
}

export const parseMcpText = (args: {
  text: string
  definedIn: string
  origin: EDefinitionOrigin
  compat?: boolean
}): McpSourceRead => {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(args.text)
  } catch (error) {
    return {
      entries: [],
      rejections: [
        {
          rejection: EMcpRejection.NotJson,
          name: undefined,
          definedIn: args.definedIn,
          origin: args.origin,
          detail: detailOf(error),
        },
      ],
    }
  }

  const file = mcpConfigFileSchema.safeParse(parsedJson)
  if (!file.success) {
    return {
      entries: [],
      rejections: [
        {
          rejection: EMcpRejection.BadShape,
          name: undefined,
          definedIn: args.definedIn,
          origin: args.origin,
          detail: formatIssues(file.error.issues),
        },
      ],
    }
  }

  return readMcpEntries({
    servers: mcpServersOf(file.data),
    definedIn: args.definedIn,
    origin: args.origin,
    ...(args.compat === true ? { toNative: compatMcpEntryToNative } : {}),
  })
}

export type McpCloudRow = { source: 'user' | 'project'; spec: unknown; accessToken?: string }

const CLOUD_ORIGIN: Readonly<Record<McpCloudRow['source'], EDefinitionOrigin>> = {
  user: EDefinitionOrigin.User,
  project: EDefinitionOrigin.Project,
}

export const parseMcpRows = (args: {
  rows: readonly McpCloudRow[]
  definedIn: string
}): McpSourceRead => {
  const entries: LoadedMcpEntry[] = []
  const rejections: McpRejection[] = []

  for (const row of args.rows) {
    const origin = CLOUD_ORIGIN[row.source]
    const parsed = mcpSpecSchema.safeParse(row.spec)
    if (parsed.success) {
      entries.push({
        ...parsed.data,
        origin,
        definedIn: args.definedIn,
        source: 'cloud',
        ...(row.accessToken === undefined ? {} : { accessToken: row.accessToken }),
      })
      continue
    }
    rejections.push({
      rejection: EMcpRejection.BadEntry,
      name: undefined,
      definedIn: args.definedIn,
      origin,
      detail: formatIssues(parsed.error.issues),
    })
  }

  return { entries, rejections }
}
