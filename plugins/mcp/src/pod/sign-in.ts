import { EToolEffect, SchemaTool, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import type { McpStore } from './store'

const signInSchema = z.strictObject({ name: z.string().min(1) })

export class McpSignInTool extends SchemaTool<typeof signInSchema> {
  readonly name = 'mcp_sign_in'
  readonly effect = EToolEffect.Write
  readonly inputSchema = signInSchema
  readonly description = [
    'Sign in to an MCP server the roster shows as needs-auth: the result is a link the operator opens and approves in their browser, which creates the grant this session uses on the next turn.',
    'Call it when an mcp__ tool answers that its server needs a sign-in, or when the mcp view reports needs-auth. Nothing is pasted back into the conversation, and the token never enters the transcript or the sandbox.',
    'A stdio server starts a process with its own credentials and has no sign-in to start.',
  ].join(' ')

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly store: McpStore,
  ) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof signInSchema>): Promise<ToolOutcome> {
    const spec = this.store.specOf(input.name)
    if (spec === undefined)
      return {
        ok: false,
        reason: `no MCP server is named ${input.name} in this session; the mcp view lists the ones it has`,
      }
    const transport = spec.transport
    if (transport?.kind !== 'http')
      return {
        ok: false,
        reason: `the ${spec.name} MCP server starts a process that carries its own credentials, so it has no sign-in to start`,
      }

    const begun = await this.ctx.control.mcp.begin({
      name: spec.name,
      source: spec.source,
      url: transport.url,
    })
    if (!begun.ok) return { ok: false, reason: begun.reason }

    return {
      ok: true,
      output: { name: spec.name, url: begun.url },
      modelText: `Open this link to sign in to the ${spec.name} MCP server: ${begun.url}\nApprove it in the browser; the grant lands on the server's row and the next turn connects it. Nothing needs to be pasted back here.`,
    }
  }
}
