export type McpToolAnnotations = {
  readOnlyHint?: boolean | undefined
  destructiveHint?: boolean | undefined
}

export type McpToolInfo = {
  name: string
  description?: string | undefined
  inputSchema?: unknown
  annotations?: McpToolAnnotations | undefined
}

export type McpCallResult = {
  content?: unknown
  structuredContent?: unknown
  isError?: boolean | undefined
}

export type McpConnection = {
  instructions?: string | undefined
  tools: readonly McpToolInfo[]
}

export type McpTransportClient = {
  connect(): Promise<McpConnection>
  callTool(args: { name: string; input: unknown }): Promise<McpCallResult>
  close(): Promise<void>
}

export class McpUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpUnauthorizedError'
  }
}

export class McpTransportError extends Error {
  constructor(
    message: string,
    readonly stderr: readonly string[] = [],
  ) {
    super(message)
    this.name = 'McpTransportError'
  }
}

export const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const annotationsOf = (raw: unknown): McpToolAnnotations => {
  const hints = asRecord(raw)
  if (hints === undefined) return {}
  const readOnly = hints['readOnlyHint']
  const destructive = hints['destructiveHint']
  return {
    ...(typeof readOnly === 'boolean' ? { readOnlyHint: readOnly } : {}),
    ...(typeof destructive === 'boolean' ? { destructiveHint: destructive } : {}),
  }
}

export const toolsOf = (result: unknown): readonly McpToolInfo[] => {
  const record = asRecord(result)
  const list = record?.['tools']
  if (!Array.isArray(list)) return []
  const tools: McpToolInfo[] = []
  for (const entry of list) {
    const tool = asRecord(entry)
    if (tool === undefined) continue
    const name = tool['name']
    if (typeof name !== 'string' || name === '') continue
    const description = tool['description']
    tools.push({
      name,
      ...(typeof description === 'string' ? { description } : {}),
      ...(tool['inputSchema'] !== undefined ? { inputSchema: tool['inputSchema'] } : {}),
      ...(tool['annotations'] !== undefined
        ? { annotations: annotationsOf(tool['annotations']) }
        : {}),
    })
  }
  return tools
}

export const callResultOf = (result: unknown): McpCallResult => {
  const record = asRecord(result)
  if (record === undefined) return {}
  return {
    ...(record['content'] !== undefined ? { content: record['content'] } : {}),
    ...(record['structuredContent'] !== undefined
      ? { structuredContent: record['structuredContent'] }
      : {}),
    ...(typeof record['isError'] === 'boolean' ? { isError: record['isError'] } : {}),
  }
}
