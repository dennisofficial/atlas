import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

export const refusalText = (reason: string): string =>
  `the operator did not deliver a value: ${reason}. No value arrived, so nothing was written or typed; ask again with a fresh request if the value is still needed.`

const inputSchema = z.strictObject({
  prompt: z.string().min(1),
  secret: z.boolean().optional(),
})

export class OperatorInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_input'
  readonly description = [
    'Ask the operator for a value only they have — a login code, a token, a password — and read it from the file the operator session writes it to. The tool waits while the question sits in the transcript for the operator to answer, then reports the path of the file holding the value and never the value itself.',
    'Ask once for a value and reuse the file for everything that needs it: read it, pipe it into a command or hand it to a shell. Never paste the value into a message or echo it into the transcript.',
    'The call fails with a reason naming why no value arrived: the operator cancelled, the session stopped waiting for the answer, the request expired unanswered, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the main session to run the login instead.',
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
    const delivery = await this.ctx.control.operator.ask({
      ask: { kind: 'input', prompt: input.prompt, secret: input.secret ?? false },
      signal,
    })
    if (!delivery.ok) return { ok: false, reason: refusalText(delivery.reason) }
    if (!('path' in delivery))
      return { ok: false, reason: refusalText('the host answered a file ask as a shell ask') }

    return {
      ok: true,
      output: { path: delivery.path, bytes: delivery.bytes },
      modelText: `the operator's value was written to ${delivery.path} (${delivery.bytes} bytes, mode 0600). Read it from there and never paste it into a message.`,
    }
  }
}
