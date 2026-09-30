import {
  deedsOf,
  EDeed,
  EReadConfidence,
  EToolEffect,
  loopCutNoticeDraft,
  loopCutPlan,
  toCallId,
  toThreadId,
  type Event,
  type LoopCut,
  type Repeatable,
  type ThreadId,
  type ToolCall,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { SHELL_TOOL_NAME, toolLensFor } from '../classifier/tool-lens'
import type { ApplyLoopCut } from '../store/sessions/ops/cut-loop'
import { loopReport } from './turn-faults'

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

export type GuardCutApplied = { cut: LoopCut }

export type GuardOutcome =
  | { kind: 'none' }
  | { kind: 'cut'; cut: LoopCut }
  | { kind: 'failed'; message: string; cause: unknown }

/**
 * One loop-guard inspection of the owned log: when the turn has repeated identical read-only
 * calls with identical results, cut the repetition from the log and say so. A turn may be cut
 * only so many times before it fails rather than spins.
 */
export async function guardRepeatLoop({
  events,
  threadId,
  tools,
  projectDirectory,
  applyLoopCut,
  onLoopCut,
  loopCuts,
}: {
  events: readonly Event[]
  threadId: ThreadId
  tools: () => readonly ToolDeclaration[]
  projectDirectory: string
  applyLoopCut: ApplyLoopCut | undefined
  onLoopCut: ((cut: LoopCut) => void) | undefined
  loopCuts: number
}): Promise<GuardOutcome> {
  if (applyLoopCut === undefined) return { kind: 'none' }

  const cut = loopCutPlan({
    events,
    repeatable: repeatableFor({ tools, projectDirectory }),
  })
  if (cut === undefined) return { kind: 'none' }

  if (loopCuts >= MAX_LOOP_CUTS_PER_TURN) {
    return { kind: 'failed', message: loopReport(cut), cause: cut }
  }

  const applied = await applyLoopCut({
    threadId,
    toSeq: cut.toSeq,
    throughSeq: cut.throughSeq,
    notice: loopCutNoticeDraft(cut),
  })
  if (!applied) return { kind: 'none' }

  onLoopCut?.(cut)
  return { kind: 'cut', cut }
}
