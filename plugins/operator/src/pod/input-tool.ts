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
})

export class OperatorInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_input'
  readonly description = [
    'Ask the operator for a value only they have — a login code, a token, a password — and read it from the file the operator session writes it to. The call parks: it ends the turn with no result while the question sits in the transcript, and its result arrives as the path of the file holding the value, never the value itself. The turn resumes when the operator answers or cancels, however long that takes; there is no deadline.',
    'The operator answer writes the value to a file under $ATLAS_SESSION_DIR/requests named after this call, at mode 0600. Ask once for a value and reuse that file for everything that needs it: read it, pipe it into a command or hand it to a shell. Never paste the value into a message or echo it into the transcript.',
    'The call fails with a reason naming why no value arrived: the operator cancelled, the session was stopped or took a message instead, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the main session to run the login instead.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    return parkedOutcomeOf({
      reason: parkedTextOf(),
      request: { kind: EOperatorRequestKind.Input, prompt: input.prompt },
    })
  }
}
