import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  parkedOutcomeOf,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { parkedTextOf, refusalTextOf } from '../core/request'
import { z } from 'zod'

const inputSchema = z.strictObject({
  prompt: z.string().min(1),
})

export class OperatorInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_input'
  readonly description = [
    'Ask the operator for a value only they have — a login code, a token, a password — and read it from the file the operator session writes it to. The call parks: it ends the turn with no result while the question sits in the transcript, and its result arrives as the path of the file holding the value, never the value itself. The turn resumes when the operator answers or cancels, however long that takes; there is no deadline.',
    'Ask once for a value and reuse the file for everything that needs it: read it, pipe it into a command or hand it to a shell. Never paste the value into a message or echo it into the transcript.',
    'The call fails with a reason naming why no value arrived: the operator cancelled, the session was stopped or took a message instead, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the main session to run the login instead.',
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
      ask: { kind: 'input', prompt: input.prompt },
      signal,
    })
    if (!opened.ok) return { ok: false, reason: refusalTextOf(opened.reason) }
    return parkedOutcomeOf(parkedTextOf(opened.requestId))
  }
}
