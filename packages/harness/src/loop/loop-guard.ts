import {
  deedsOf,
  EDeed,
  EReadConfidence,
  EToolEffect,
  toCallId,
  toThreadId,
  type Repeatable,
  type ToolCall,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { SHELL_TOOL_NAME, toolLensFor } from '../classifier/tool-lens'

export const MAX_LOOP_CUTS_PER_TURN = 2

const GUARD_CALL_ID = toCallId('loop-guard')
const GUARD_THREAD_ID = toThreadId('loop-guard')

const recordOf = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : undefined

/**
 * The loop may cut repeats of a call only when the call provably changed nothing outside the
 * log. A declared Read tool qualifies outright. `bash` is statically Destructive, so it is
 * judged per command with the classifier's own reading: every deed must be read-only, and a
 * backgrounded command is a shell creation whatever it runs.
 */
export function repeatableFor({
  tools,
  projectDirectory,
}: {
  tools: () => readonly ToolDeclaration[]
  projectDirectory: string
}): Repeatable {
  const lens = toolLensFor({ tools: tools() })

  return ({ name, input }) => {
    if (name !== SHELL_TOOL_NAME) return lens.effectOf(name) === EToolEffect.Read

    if (recordOf(input)?.runInBackground === true) return false

    const reading = lens.readingFor({ name, input, projectDirectory })
    if (reading === undefined) return false
    if (reading.confidence !== EReadConfidence.Read) return false
    if (reading.segments.some((segment) => segment.pipesIntoInterpreter)) return false

    const call: ToolCall = {
      callId: GUARD_CALL_ID,
      name,
      input,
      effect: lens.effectOf(name),
      threadId: GUARD_THREAD_ID,
    }
    const deeds = deedsOf({
      call,
      declaration: lens.declarationFor(name),
      reading,
      projectDirectory,
    })

    return deeds.length > 0 && deeds.every((deed) => deed.action === EDeed.ReadOnly)
  }
}
