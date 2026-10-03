import { z } from 'zod'
import { EToolEffect, SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'

import { ShellRegistryPort } from '../../shells/shell-registry'

const inputSchema = z.strictObject({
  shellId: z.string().min(1),
  text: z.string(),
  end: z.boolean().optional(),
})

export class ShellInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_input'
  readonly description = 'Send text to a background shell’s stdin without interrupting it. Include a newline when answering a line-oriented prompt. Set end to close stdin after the text; closing stdin is permanent for that shell. This is a pipe, not a terminal: full-screen terminal programs and terminal-only password prompts are not supported. Input remains available after Atlas reconnects to a durable shell.'
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly shells: Pick<ShellRegistryPort, 'writeInput'>) {
    super()
  }

  protected override async run(args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const result = await this.shells.writeInput({
      threadId: args.threadId,
      shellId: args.input.shellId,
      text: args.input.text,
      end: args.input.end,
    })
    if (!result.ok) return result
    return {
      ok: true,
      output: { shellId: args.input.shellId, bytes: Buffer.byteLength(args.input.text), ended: args.input.end === true },
      modelText: `Sent input to shell ${args.input.shellId}${args.input.end === true ? ' and closed its stdin' : ''}. Output and completion arrive through its normal watch and ending notifications.`,
    }
  }
}
