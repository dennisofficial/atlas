import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  parkedOutcomeOf,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { EOperatorRequestKind, parkedTextOf } from '../core/request'

const inputSchema = z.strictObject({
  prompt: z.string().min(1),
  shellId: z.string().min(1),
})

export class OperatorShellInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_shell_input'
  readonly description = [
    'Ask the operator for a value that only they have, and type it straight into the stdin of a background shell that this session already started. shellId names that shell. Start the CLI with `bash`, background and input set to true. Read its output for the printed login URL or prompt, and pass that as the prompt.',
    'The call parks: it ends the turn with no result while the question sits in the thread. The result arrives as the byte count once the operator answers, never the value. The value reaches the CLI’s stdin and nowhere else, so read the shell’s output with `shell_output` to see what the CLI did with it. The turn resumes when the operator answers or cancels, however long that takes. There is no deadline. If the shell is gone by the time the operator answers, the call fails and names the shell.',
    'The call fails with a reason that names why no value arrived: the operator cancelled, the session was stopped or took a message instead, the shell was gone, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the parent agent to run the login instead.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  readonly deferred = true
  override readonly pathFields = TAKES_NO_PATHS

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    return parkedOutcomeOf({
      reason: parkedTextOf(),
      request: {
        kind: EOperatorRequestKind.Shell,
        prompt: input.prompt,
        shellId: input.shellId,
      },
    })
  }
}
