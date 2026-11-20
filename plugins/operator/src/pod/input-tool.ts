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
    'Ask the operator for a value that only they have, such as a login code, a token or a password.',
    'The call parks: it ends the turn with no result while the question sits in the transcript. The turn resumes when the operator answers or cancels, however long that takes. There is no deadline.',
    'The operator answer writes the value to a file under $ATLAS_SESSION_DIR/requests named after this call, at mode 0600. The result arrives as the path of that file, never the value itself. Ask once for a value, then reuse that file: read it, pipe it into a command or give it to a shell. Never paste the value into a message or echo it into the transcript.',
    'The call fails with a reason that names why no value arrived: the operator cancelled, the session was stopped or took a message instead, or the delivery failed. The operator is the only one who can answer, so a sub-agent asks the parent agent to run the login instead.',
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
