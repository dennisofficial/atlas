import { EToolEffect, SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'

import { cloudClientFor } from '../../cloud/cloud-client'
import type { CloudSessionStore } from '../../cloud/cloud-session'
import { CloudSignInRequiredError } from '../../cloud/sign-in-required'
import { EMcpEditLayer, inputSchema, run, runRemote } from '../../mcp/config/writer'

const description = [
  'Edit the mcp server list in one config file: install a server, disable it, enable it, or remove it.',
  'The layer picks the target: user is the Atlas Cloud account (requires sign-in), project is <cwd>/.atlas/mcp.json, project-compat is <cwd>/.mcp.json.',
  'upsert writes { transport, trusted? }; disable writes a stub with disabled: true; enable re-writes the stub without disabled; remove deletes the entry.',
  'The name and transport are validated the same way the loaders read them, so an invalid one fails before the file is touched.',
  'Remove of an unknown name succeeds; the file is simply left as it was.',
].join(' ')

export class McpEditTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'mcp-edit'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly args: {
      sessions?: CloudSessionStore
      cloudRequired?: () => boolean
      clientVersion?: string
    } = {},
  ) {
    super()
  }

  protected override async run(args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (args.input.layer !== EMcpEditLayer.User) return await run(args)

    const session = this.args.sessions?.read() ?? null
    if (session !== null) {
      return await runRemote({
        input: args.input,
        client: cloudClientFor({ session, clientVersion: this.args.clientVersion ?? 'dev' }),
      })
    }

    if (this.args.cloudRequired?.() === true) {
      return { ok: false, reason: new CloudSignInRequiredError().message }
    }

    return await run(args)
  }
}
