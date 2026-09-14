import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  SchemaTool,
  type DeclaredPathField,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { CloudClient } from '../../cloud/cloud-client'
import type { CloudSessionStore } from '../../cloud/cloud-session'
import { EMcpEditLayer, inputSchema, run, runRemote } from '../../mcp/config/writer'

const description = [
  'Edit the mcp server list in one config file: install a server, disable it, enable it, or remove it.',
  'The layer picks the target: user is the Atlas Cloud account when signed in and ~/.atlas/mcp.json otherwise, project is <cwd>/.atlas/mcp.json, project-compat is <cwd>/.mcp.json.',
  'upsert writes { transport, trusted? }; disable writes a stub with disabled: true; enable re-writes the stub without disabled; remove deletes the entry.',
  'The name and transport are validated the same way the loaders read them, so an invalid one fails before the file is touched.',
  'Remove of an unknown name succeeds; the file is simply left as it was.',
].join(' ')

export class McpEditTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'mcp-edit'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'layer',
      presence: EPathPresence.Required,
      form: EPathForm.Absolute,
      content: EContentAccess.Amends,
    },
  ]

  constructor(private readonly args: { sessions?: CloudSessionStore } = {}) {
    super()
  }

  protected override async run(args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const session = this.args.sessions?.read() ?? null
    if (session !== null && args.input.layer === EMcpEditLayer.User) {
      return await runRemote({
        input: args.input,
        client: new CloudClient({ url: session.url, token: session.token }),
      })
    }

    return await run(args)
  }
}
