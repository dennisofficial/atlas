import { z } from 'zod'

import type { ToolDeclaration } from './tool'

export const CALL_TOOL_NAME = 'call_tool'

export const TOOL_SEARCH_NAME = 'tool_search'

export const DEFERRED_TOOLS_SOURCE = 'deferred-tools'

export const MCP_TOOL_PREFIX = 'mcp__'

const MCP_TOOL_SEPARATOR = '__'

const ATLAS_TOOL_GROUP = 'atlas'

const TOOL_SEARCH_LIMIT = 5

export const callToolInputSchema = z.strictObject({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
})

export const toolSearchInputSchema = z.strictObject({ query: z.string() })

export type McpToolParts = { server: string; tool: string }

export const mcpPartsOf = (name: string): McpToolParts | undefined => {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf(MCP_TOOL_SEPARATOR)
  if (separator <= 0) return undefined
  const tool = rest.slice(separator + MCP_TOOL_SEPARATOR.length)
  return tool === '' ? undefined : { server: rest.slice(0, separator), tool }
}

export const isDeferredDeclaration = (declaration: Pick<ToolDeclaration, 'deferred'>): boolean =>
  declaration.deferred === true

export const deferredDeclarationsOf = (
  declarations: readonly ToolDeclaration[],
): readonly ToolDeclaration[] => declarations.filter(isDeferredDeclaration)

export const modelFacingDeclarationsOf = (
  declarations: readonly ToolDeclaration[],
): readonly ToolDeclaration[] =>
  declarations.filter((declaration) => !isDeferredDeclaration(declaration))

export const toolNamesByServerOf = (
  declarations: readonly ToolDeclaration[],
): ReadonlyMap<string, readonly string[]> => {
  const groups = new Map<string, string[]>()
  for (const declaration of deferredDeclarationsOf(declarations)) {
    const server = mcpPartsOf(declaration.name)?.server ?? ATLAS_TOOL_GROUP
    const names = groups.get(server) ?? []
    names.push(declaration.name)
    groups.set(server, names)
  }
  return groups
}

export const serverListingTextOf = (groups: ReadonlyMap<string, readonly string[]>): string =>
  [...groups].map(([server, names]) => `${server}: ${names.join(', ')}`).join('\n')

export const deferredListingTextOf = (declarations: readonly ToolDeclaration[]): string =>
  serverListingTextOf(toolNamesByServerOf(declarations))

const wordsOf = (query: string): readonly string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')

const matchesQuery = (args: {
  declaration: ToolDeclaration
  words: readonly string[]
}): boolean => {
  const haystack = `${args.declaration.name} ${args.declaration.description}`.toLowerCase()
  return args.words.every((word) => haystack.includes(word))
}

const jsonSchemaOf = (declaration: ToolDeclaration): unknown => {
  if (declaration.jsonSchema !== undefined) return declaration.jsonSchema
  try {
    return z.toJSONSchema(declaration.inputSchema, { io: 'input' })
  } catch {
    return {}
  }
}

const renderMatch = (declaration: ToolDeclaration): string =>
  [
    declaration.name,
    declaration.description,
    JSON.stringify(jsonSchemaOf(declaration) ?? {}, null, 2),
  ].join('\n')

const NO_DEFERRED_TOOLS = 'no deferred tools are in this session'

export const toolSearchTextOf = (args: {
  declarations: readonly ToolDeclaration[]
  query: string
}): string => {
  const deferred = deferredDeclarationsOf(args.declarations)
  if (deferred.length === 0) return `${NO_DEFERRED_TOOLS}.`

  const words = wordsOf(args.query)
  const matches =
    words.length === 0 ? [] : deferred.filter((declaration) => matchesQuery({ declaration, words }))

  if (matches.length === 0) {
    const missed =
      words.length === 0
        ? ''
        : `No deferred tool matched "${args.query}". Every deferred tool, by server:\n`
    return `${missed}${deferredListingTextOf(deferred)}`
  }

  const shown = matches.slice(0, TOOL_SEARCH_LIMIT)
  const noun = shown.length === 1 ? 'tool' : 'tools'
  const header =
    matches.length > shown.length
      ? `${matches.length} deferred tools matched; the first ${shown.length}:`
      : `${matches.length} deferred ${noun} matched:`
  return [header, ...shown.map(renderMatch)].join('\n\n')
}

export type ResolvedToolCall =
  | { kind: 'direct'; name: string; input: unknown }
  | { kind: 'deferred'; name: string; input: unknown }
  | { kind: 'refused'; name: string; reason: string }

const refused = (args: { name: string; reason: string }): ResolvedToolCall => ({
  kind: 'refused',
  name: args.name,
  reason: args.reason,
})

export const resolveToolCallOf = (args: {
  declarations: readonly ToolDeclaration[]
  name: string
  input: unknown
}): ResolvedToolCall => {
  if (args.name !== CALL_TOOL_NAME) {
    const called = args.declarations.find((declaration) => declaration.name === args.name)
    const kind = called !== undefined && isDeferredDeclaration(called) ? 'deferred' : 'direct'
    return { kind, name: args.name, input: args.input }
  }

  const parsed = callToolInputSchema.safeParse(args.input)
  if (!parsed.success)
    return refused({
      name: args.name,
      reason: `${CALL_TOOL_NAME} takes a tool name and its args object: ${z.prettifyError(parsed.error)}. Nothing ran; call ${TOOL_SEARCH_NAME} to get the tool's schema.`,
    })

  const target = args.declarations.find((declaration) => declaration.name === parsed.data.tool)
  if (target === undefined)
    return refused({
      name: args.name,
      reason: `no tool is named "${parsed.data.tool}" in this session; call ${TOOL_SEARCH_NAME} to find one. Nothing ran.`,
    })
  if (!isDeferredDeclaration(target))
    return refused({
      name: args.name,
      reason: `"${parsed.data.tool}" is not a deferred tool, so call it directly instead of through ${CALL_TOOL_NAME}; ${TOOL_SEARCH_NAME} lists the tools that are deferred. Nothing ran.`,
    })

  return { kind: 'deferred', name: target.name, input: parsed.data.args }
}
