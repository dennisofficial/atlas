import { ToolRegistry } from '@dltech/atlas-agent'
import {
  CALL_TOOL_NAME,
  callToolInputSchema,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  TOOL_SEARCH_NAME,
  toolSearchInputSchema,
  toolSearchTextOf,
  type ToolDeclaration,
  type ToolDefinition,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

const SEARCH_DESCRIPTION = [
  "Find a tool that is available but not loaded, such as an MCP server's tools, without spending the prompt on its schema.",
  'Pass a word or two from the tool name or what it does; it answers with up to 5 matching tools, each with its full name, description and input schema. An empty or unmatched query lists every deferred tool name by server.',
  `Run one with ${CALL_TOOL_NAME}.`,
].join(' ')

const CALL_DESCRIPTION = [
  'Run a tool that is available but not loaded, by its full name.',
  `Pass args as the object that tool's input schema describes, which ${TOOL_SEARCH_NAME} gives you.`,
].join(' ')

export class ToolSearchTool extends SchemaTool<typeof toolSearchInputSchema> {
  readonly name = TOOL_SEARCH_NAME
  readonly description = SEARCH_DESCRIPTION
  readonly effect = EToolEffect.Read
  readonly inputSchema = toolSearchInputSchema
  override readonly pathFields = TAKES_NO_PATHS
  override readonly isConcurrencySafe = (): boolean => true
  private readonly declarations: () => readonly ToolDeclaration[]

  constructor(declarations: () => readonly ToolDeclaration[]) {
    super()
    this.declarations = declarations
  }

  protected override async run({
    input,
  }: ToolRun<typeof toolSearchInputSchema>): Promise<ToolOutcome> {
    const text = toolSearchTextOf({ declarations: this.declarations(), query: input.query })
    return { ok: true, output: { text }, modelText: text }
  }
}

const CALL_TOOL_DECLARATION: ToolDeclaration = {
  name: CALL_TOOL_NAME,
  description: CALL_DESCRIPTION,
  effect: EToolEffect.Write,
  inputSchema: callToolInputSchema,
  jsonSchema: z.toJSONSchema(callToolInputSchema, { io: 'input' }),
}

export class DiscoveryToolsRegistry extends ToolRegistry {
  private readonly search: ToolSearchTool

  constructor(private readonly base: ToolRegistry) {
    super()
    this.search = new ToolSearchTool(() => this.base.declarations())
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.base.declarations(), CALL_TOOL_DECLARATION, this.search]
  }

  find(name: string): ToolDefinition | undefined {
    return name === TOOL_SEARCH_NAME ? this.search : this.base.find(name)
  }
}

export const withDiscoveryTools = (registry: ToolRegistry): ToolRegistry =>
  new DiscoveryToolsRegistry(registry)
