import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { writeShell } from './daemon'
import type { ShellPodState } from './state'

const inputSchema = z.strictObject({
  shellId: z.string().min(1),
  text: z.string(),
  end: z.boolean().optional(),
})

export class ShellInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_input'
  readonly description =
    'Send text to the stdin of a background shell without interrupting it. Include a newline when you answer a line-oriented prompt. The shell must have been started by bash with background and input set to true. Set end to close stdin after the text, which is permanent for that shell. This is a pipe, not a terminal, so a full-screen terminal program and a terminal-only password prompt are not supported.'
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ShellPodState,
  ) {
    super()
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const written = await writeShell({
      ctx: this.ctx,
      shellId: input.shellId,
      data: input.text,
      end: input.end,
      signal,
    })
    if (!written.ok) return { ok: false, reason: written.reason }
    if (input.text.length > 0) this.state.awaiting.delete(input.shellId)
    const ended = input.end === true
    return {
      ok: true,
      output: {
        shellId: input.shellId,
        bytes: Buffer.byteLength(input.text),
        ended,
      },
      modelText: `Sent input to shell ${input.shellId}${ended ? ' and closed its stdin' : ''}. Its output and its ending arrive on their own.`,
    }
  }
}
