import { EToolEffect, SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'

import { inputSchema, run } from '../../mcp/config/writer'

const description = [
  'Edit the mcp server list in one config file: install a server, disable it, enable it, or remove it.',
  'The layer picks the target: user is the local user mcp file, including when signed in to Atlas Cloud; project is <cwd>/.atlas/mcp.json, project-compat is <cwd>/.mcp.json.',
  'upsert writes { transport }; disable writes a stub with disabled: true; enable re-writes the stub without disabled; remove deletes the entry.',
  'The name and transport are validated the same way the loaders read them, so an invalid one fails before the file is touched.',
  'Remove of an unknown name succeeds; the file is simply left as it was.',
].join(' ')

export class McpEditTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'mcp-edit'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  protected override async run(args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    return await run(args)
  }
}
