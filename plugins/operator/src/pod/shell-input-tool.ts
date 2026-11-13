import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  parkedOutcomeOf,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { parkedTextOf, refusalTextOf } from '../core/request'

const inputSchema = z.strictObject({
  prompt: z.string().min(1),
  secret: z.boolean().optional(),
  shellId: z.string().min(1),
})

export class OperatorShellInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_shell_input'
  readonly description = [
    'Ask the operator for a value only they have and type it straight into the stdin of a background shell this session already started, identified by shellId. Start the CLI with the `shell` tool and input set to true, read its output for the printed login URL or prompt, and pass that as the prompt.',
    'The call parks: it ends the turn with no result while the question sits in the transcript, and its result arrives as the byte count once the operator answers, never the value: it reaches the CLI’s stdin and nowhere else, so read the shell’s output with `shell_output` to see what the CLI did with it. If the shell is gone by the time the operator answers, the call fails and names the shell.',
    'The call fails with a reason naming why no value arrived: the operator cancelled, the session was stopped or took a message instead, the shell was gone, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the main session to run the login instead.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const opened = await this.ctx.control.operator.ask({
      ask: {
        kind: 'shell',
        prompt: input.prompt,
        secret: input.secret ?? false,
        shellId: input.shellId,
      },
      signal,
    })
    if (!opened.ok) return { ok: false, reason: refusalTextOf(opened.reason) }
    return parkedOutcomeOf(parkedTextOf(opened.requestId))
  }
}
